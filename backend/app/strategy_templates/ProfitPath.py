import logging
import warnings
from datetime import datetime

warnings.filterwarnings('ignore')

logger = logging.getLogger(__name__)
import talib.abstract as ta

import numpy as np
from pandas import DataFrame
from typing import Optional, Dict, Any
from freqtrade.persistence import Trade
from freqtrade.strategy import (
    IStrategy,
    informative,  # @informative decorator
    # Hyperopt Parameters
    BooleanParameter,
    DecimalParameter,
    IntParameter,
    stoploss_from_open,
)
from scipy.signal import argrelextrema
import pandas as pd

warnings.simplefilter(action="ignore", category=pd.errors.PerformanceWarning)

class ProfitPath(IStrategy):

    # Core trade behavior
    exit_profit_only = True
    trailing_stop = False
    position_adjustment_enable = True
    ignore_roi_if_entry_signal = True
    max_entry_position_adjustment = 1
    max_dca_multiplier = 1

    # DCA re-entry window (profit ratio): allow DCA only between these bounds
    dca_reentry_min_profit = -0.15
    dca_reentry_max_drawdown = -0.5

    # 24h change filter bounds per entry timeframe
    chg_30m_min = -15.0
    chg_30m_max = 15.0
    chg_1h_min = -15.0
    chg_1h_max = 15.0
    chg_4h_min = -15.0
    chg_4h_max = 15.0

    # 24h change filter bounds per timeframe for DCA orders (separate from entry bounds)
    dca_chg_30m_min = -15.0
    dca_chg_30m_max = 15.0
    dca_chg_1h_min = -15.0
    dca_chg_1h_max = 15.0
    dca_chg_4h_min = -15.0
    dca_chg_4h_max = 15.0

    # Extra distance beyond min/max to force custom exit (example: -5 with buffer 2 => exit at -7)
    chg_30m_exit_buffer = 2.0
    chg_1h_exit_buffer = 2.0
    chg_4h_exit_buffer = 2.0

    # Enable/disable change filter globally and per timeframe
    use_chg_filter = True
    chg_30m_enabled = True
    chg_1h_enabled = True
    chg_4h_enabled = True

    # Telegram alerts when 24h change crosses configured thresholds
    telegram_chg_alert_enabled = True
    telegram_chg_min = -5.0
    telegram_chg_max = 5.0
    telegram_chg_alert_state: Dict[str, Dict[str, Any]] = {}

    # Strategy/runtime settings
    process_only_new_candles = True
    can_short = True
    use_exit_signal = True
    startup_candle_count: int = 200
    stoploss = -0.99
    dca_stoploss = -0.5
    leverage_value = 5

    # Stake allocation ratios (portion of proposed stake)
    initial_entry_stake_ratio = 0.5
    dca_entry_stake_ratio = 0.5

    # Enable/disable entries per timeframe
    entry_30m_enabled = True
    entry_1h_enabled = True
    entry_4h_enabled = True

    # Base strategy timeframes
    use_custom_stoploss = True
    timeframe = "5m"
    informative_timeframe = "4h"

    # DCA 
    initial_safety_order_trigger = DecimalParameter(
        low=-0.02, high=-0.01, default=-0.018, decimals=3, space="entry", optimize=True, load=True
    )
    max_safety_orders = IntParameter(1, 6, default=3, space="entry", optimize=True)
    safety_order_step_scale = DecimalParameter(
        low=1.05, high=1.5, default=1.25, decimals=2, space="entry", optimize=True, load=True
    )
    safety_order_volume_scale = DecimalParameter(
        low=1.1, high=2, default=1.4, decimals=1, space="entry", optimize=True, load=True
    )

    # Custom Functions
    increment = DecimalParameter(
        low=1.0005, high=1.002, default=1.001, decimals=4, space="entry", optimize=True, load=True
    )
    last_entry_price = None
    

    # Protections
    cooldown_lookback = IntParameter(2, 48, default=1, space="protection", optimize=True)
    stop_duration = IntParameter(12, 200, default=4, space="protection", optimize=True)
    use_stop_protection = BooleanParameter(default=True, space="protection", optimize=True)

    minimal_roi = {
        "0": 0.5,
        "60": 0.45,
        "120": 0.4,
        "240": 0.3,
        "360": 0.25,
        "720": 0.2,
        "1440": 0.15,
        "2880": 0.1,
        "3600": 0.05,
        "7200": 0.02,
    }

    plot_config = {
        "main_plot": {
        },
        "subplots": {
            "RSI": {
                "rsi_5m": {"color": "#1f77b4", "type": "line"},
                "rsi_30m": {"color": "#ff520e", "type": "line", "secondary_y": False},
                "rsi_1h": {"color": "#ff7f0e", "type": "line", "secondary_y": False},
                "rsi_4h": {"color": "#2ca02c", "type": "line", "secondary_y": False},
            },
            "24H CHG %": {
                "chg_pct": {"color": "#d62728", "type": "line"},
            },
        },
    }

    @property
    def protections(self):
        prot = []
        prot.append(
            {"method": "CooldownPeriod", "stop_duration_candles": self.cooldown_lookback.value}
        )
        if self.use_stop_protection.value:
            prot.append(
                {
                    "method": "StoplossGuard",
                    "lookback_period_candles": 24 * 3,
                    "trade_limit": 2,
                    "stop_duration_candles": self.stop_duration.value,
                    "only_per_pair": False,
                }
            )
        return prot

    def custom_stake_amount(
            self,
            pair: str,
            current_time: datetime,
            current_rate: float,
            proposed_stake: float,
            min_stake: Optional[float],
            max_stake: float,
            leverage: float,
            entry_tag: Optional[str],
            side: str,
            **kwargs,
    ) -> float:
        # Split proposed stake using configurable ratios for initial entry vs DCA.
        trade = kwargs.get('trade')
        if trade is not None and hasattr(trade, 'nr_of_successful_entries'):
            if trade.nr_of_successful_entries == 0:
                return proposed_stake * self.initial_entry_stake_ratio
            else:
                return proposed_stake * self.dca_entry_stake_ratio
        else:
            return proposed_stake * self.initial_entry_stake_ratio

    def custom_entry_price(
            self,
            pair: str,
            trade: Optional["Trade"],
            current_time: datetime,
            proposed_rate: float,
            entry_tag: Optional[str],
            side: str,
            **kwargs,
    ) -> float:
        dataframe, _ = self.dp.get_analyzed_dataframe(
            pair=pair, timeframe=self.timeframe
        )
        entry_price = (dataframe["close"].iloc[-1] + dataframe["open"].iloc[-1] + proposed_rate) / 3
        if proposed_rate < entry_price:
            entry_price = proposed_rate

        logger.info(
            f"{pair} Using Entry Price: {entry_price} | close: {dataframe['close'].iloc[-1]} open: {dataframe['open'].iloc[-1]} proposed_rate: {proposed_rate}"
        )

        if self.last_entry_price is not None and abs(entry_price - self.last_entry_price) < 0.0005:
            entry_price *= self.increment.value
            logger.info(
                f"{pair} Incremented entry price: {entry_price} based on previous entry price : {self.last_entry_price}."
            )

        self.last_entry_price = entry_price

        return entry_price

    def confirm_trade_exit(
            self,
            pair: str,
            trade: Trade,
            order_type: str,
            amount: float,
            rate: float,
            time_in_force: str,
            exit_reason: str,
            current_time: datetime,
            **kwargs,
    ) -> bool:
        if exit_reason == "partial_exit" and trade.calc_profit_ratio(rate) < 0:
            logger.info(f"{trade.pair} partial exit is below 0")
            self.dp.send_msg(f"{trade.pair} partial exit is below 0")
            return False
        if exit_reason == "trailing_stop_loss" and trade.calc_profit_ratio(rate) < 0:
            logger.info(f"{trade.pair} trailing stop price is below 0")
            self.dp.send_msg(f"{trade.pair} trailing stop price is below 0")
            return False
        return True

    def adjust_trade_position(
            self,
            trade: Trade,
            current_time: datetime,
            current_rate: float,
            current_profit: float,
            min_stake: Optional[float],
            max_stake: float,
            current_entry_rate: float,
            current_exit_rate: float,
            current_entry_profit: float,
            current_exit_profit: float,
            **kwargs,
    ) -> Optional[float]:
        dataframe, _ = self.dp.get_analyzed_dataframe(trade.pair, self.timeframe)
        filled_entries = trade.select_filled_orders(trade.entry_side)
        count_of_entries = trade.nr_of_successful_entries

        # Partial take-profit: scale out in two steps at +25% and +40%.
        if current_profit > 0.25 and trade.nr_of_successful_exits == 0:
            return -(trade.stake_amount / 4)
        if current_profit > 0.40 and trade.nr_of_successful_exits == 1:
            return -(trade.stake_amount / 3)

        # Allow exactly one re-entry: only when the trade has one filled entry.
        if count_of_entries != 1:
            return None

        # Re-entry is allowed only between configured min/max DCA profit bounds.
        if (
            current_profit > self.dca_reentry_min_profit
            or current_profit < self.dca_reentry_max_drawdown
        ):
            return None

        if not filled_entries or dataframe.empty:
            return None

        last_candle = dataframe.iloc[-1]
        prev_candle = dataframe.iloc[-2] if len(dataframe) >= 2 else None
        is_short_trade = bool(getattr(trade, "is_short", False))
        entry_tag = (getattr(trade, "enter_tag", "") or "").strip()

        def chg_ok(column_name: str, min_value: float, max_value: float, enabled: bool = True) -> bool:
            if not self.use_chg_filter or not enabled:
                return True
            value = last_candle.get(column_name, 0)
            return min_value <= value <= max_value

        if is_short_trade:
            signal_by_tag = {
                "30M - Short": self.entry_30m_enabled and (
                    last_candle.get("maxima_check_30m", 1) == 0
                    and last_candle.get("volume_30m", 0) > 0
                    and last_candle.get("rsi_30m", 0) > 70
                    and chg_ok("chg_pct", self.dca_chg_30m_min, self.dca_chg_30m_max, self.chg_30m_enabled)
                    and last_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > 60
                ),
                "30M - Shift Short": self.entry_30m_enabled and (
                    last_candle.get("DI_catch_30m", 0) == 1
                    and last_candle.get("maxima_check_30m", 1) == 0
                    and prev_candle is not None
                    and prev_candle.get("maxima_check_30m", 0) == 1
                    and last_candle.get("volume_30m", 0) > 0
                    and last_candle.get("rsi_30m", 0) > 70
                    and chg_ok("chg_pct", self.dca_chg_30m_min, self.dca_chg_30m_max, self.chg_30m_enabled)
                    and last_candle.get("maxima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > 60
                ),
                "1H - Short": self.entry_1h_enabled and (
                    last_candle.get("maxima_check_1h", 1) == 0
                    and last_candle.get("volume_1h", 0) > 0
                    and last_candle.get("rsi_1h", 0) > 70
                    and chg_ok("chg_pct", self.dca_chg_1h_min, self.dca_chg_1h_max, self.chg_1h_enabled)
                    and last_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > 60
                ),
                "1H - Shift Short": self.entry_1h_enabled and (
                    last_candle.get("DI_catch_1h", 0) == 1
                    and last_candle.get("maxima_check_1h", 1) == 0
                    and prev_candle is not None
                    and prev_candle.get("maxima_check_1h", 0) == 1
                    and last_candle.get("volume_1h", 0) > 0
                    and last_candle.get("rsi_1h", 0) > 70
                    and chg_ok("chg_pct", self.dca_chg_1h_min, self.dca_chg_1h_max, self.chg_1h_enabled)
                    and last_candle.get("maxima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > 60
                ),
                "4H - Short": self.entry_4h_enabled and (
                    last_candle.get("maxima_check_4h", 1) == 0
                    and last_candle.get("volume_4h", 0) > 0
                    and last_candle.get("rsi_4h", 0) > 70
                    and chg_ok("chg_pct", self.dca_chg_4h_min, self.dca_chg_4h_max, self.chg_4h_enabled)
                    and last_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > 60
                ),
                "4H - Shift Short": self.entry_4h_enabled and (
                    last_candle.get("DI_catch_4h", 0) == 1
                    and last_candle.get("maxima_check_4h", 1) == 0
                    and prev_candle is not None
                    and prev_candle.get("maxima_check_4h", 0) == 1
                    and last_candle.get("volume_4h", 0) > 0
                    and last_candle.get("rsi_4h", 0) > 70
                    and chg_ok("chg_pct", self.dca_chg_4h_min, self.dca_chg_4h_max, self.chg_4h_enabled)
                    and last_candle.get("maxima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > 60
                ),
            }
        else:
            signal_by_tag = {
                "30M - Long": self.entry_30m_enabled and (
                    last_candle.get("minima_check_30m", 1) == 0
                    and last_candle.get("volume_30m", 0) > 0
                    and last_candle.get("rsi_30m", 100) < 30
                    and chg_ok("chg_pct", self.dca_chg_30m_min, self.dca_chg_30m_max, self.chg_30m_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < 40
                ),
                "30M - Shift Long": self.entry_30m_enabled and (
                    last_candle.get("DI_catch_30m", 0) == 1
                    and last_candle.get("minima_check_30m", 1) == 0
                    and prev_candle is not None
                    and prev_candle.get("minima_check_30m", 0) == 1
                    and last_candle.get("volume_30m", 0) > 0
                    and last_candle.get("rsi_30m", 100) < 30
                    and chg_ok("chg_pct", self.dca_chg_30m_min, self.dca_chg_30m_max, self.chg_30m_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < 40
                ),
                "1H - Long": self.entry_1h_enabled and (
                    last_candle.get("minima_check_1h", 1) == 0
                    and last_candle.get("volume_1h", 0) > 0
                    and last_candle.get("rsi_1h", 100) < 30
                    and chg_ok("chg_pct", self.dca_chg_1h_min, self.dca_chg_1h_max, self.chg_1h_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < 40
                ),
                "1H - Shift Long": self.entry_1h_enabled and (
                    last_candle.get("DI_catch_1h", 0) == 1
                    and last_candle.get("minima_check_1h", 1) == 0
                    and prev_candle is not None
                    and prev_candle.get("minima_check_1h", 0) == 1
                    and last_candle.get("volume_1h", 0) > 0
                    and last_candle.get("rsi_1h", 100) < 30
                    and chg_ok("chg_pct", self.dca_chg_1h_min, self.dca_chg_1h_max, self.chg_1h_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < 40
                ),
                "4H - Long": self.entry_4h_enabled and (
                    last_candle.get("minima_check_4h", 1) == 0
                    and last_candle.get("volume_4h", 0) > 0
                    and last_candle.get("rsi_4h", 100) < 30
                    and chg_ok("chg_pct", self.dca_chg_4h_min, self.dca_chg_4h_max, self.chg_4h_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < 40
                ),
                "4H - Shift Long": self.entry_4h_enabled and (
                    last_candle.get("DI_catch_4h", 0) == 1
                    and last_candle.get("minima_check_4h", 1) == 0
                    and prev_candle is not None
                    and prev_candle.get("minima_check_4h", 0) == 1
                    and last_candle.get("volume_4h", 0) > 0
                    and last_candle.get("rsi_4h", 100) < 30
                    and chg_ok("chg_pct", self.dca_chg_4h_min, self.dca_chg_4h_max, self.chg_4h_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < 40
                ),
            }

        matching_signal_tags = [tag for tag, is_active in signal_by_tag.items() if is_active]
        if not matching_signal_tags:
            return None

        # DCA is allowed only when an active signal is from the same timeframe as the original entry.
        if entry_tag:
            entry_timeframe = entry_tag.split(" - ", 1)[0]
            active_timeframes = {tag.split(" - ", 1)[0] for tag in matching_signal_tags}
            if entry_timeframe not in active_timeframes:
                return None

        try:
            stake_amount = filled_entries[0].cost
            dca_scale = float(self.safety_order_volume_scale.value) ** (count_of_entries - 1)
            stake_amount = stake_amount * dca_scale

            if min_stake is not None and stake_amount < min_stake:
                return None

            return min(stake_amount, max_stake)
        except Exception as exception:
            logger.debug("DCA position adjust failed for %s: %s", trade.pair, exception)
            return None
        return None

    def leverage(
            self,
            pair: str,
            current_time: "datetime",
            current_rate: float,
            proposed_leverage: float,
            max_leverage: float,
            side: str,
            **kwargs,
    ) -> float:
        # Leverage is configurable and capped by exchange/pair max leverage.
        return max(min(self.leverage_value, max_leverage), 1.0)

    def custom_stoploss(
            self,
            pair: str,
            trade: Trade,
            current_time: datetime,
            current_rate: float,
            current_profit: float,
            **kwargs,
    ) -> float:
        if trade.nr_of_successful_entries > 1:
            return stoploss_from_open(self.dca_stoploss, current_profit)
        return self.stoploss

    def custom_exit(
            self,
            pair: str,
            trade: Trade,
            current_time: datetime,
            current_rate: float,
            current_profit: float,
            **kwargs,
    ) -> Optional[str]:
        dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        if dataframe.empty:
            return None

        chg_value = dataframe.iloc[-1].get("chg_pct", np.nan)
        if pd.isna(chg_value):
            return None

        timeframe = (getattr(trade, "enter_tag", "") or "").split(" - ", 1)[0]
        bounds_by_tf = {
            "30M": (self.chg_30m_min, self.chg_30m_max),
            "1H": (self.chg_1h_min, self.chg_1h_max),
            "4H": (self.chg_4h_min, self.chg_4h_max),
        }
        buffers_by_tf = {
            "30M": self.chg_30m_exit_buffer,
            "1H": self.chg_1h_exit_buffer,
            "4H": self.chg_4h_exit_buffer,
        }
        bounds = bounds_by_tf.get(timeframe)
        if not bounds:
            return None
        exit_buffer = buffers_by_tf.get(timeframe, 2.0)

        chg_min, chg_max = bounds
        lower_exit = chg_min - exit_buffer
        upper_exit = chg_max + exit_buffer
        chg_value = float(chg_value)
        is_short_trade = bool(getattr(trade, "is_short", False))

        # Long: use the downside breach (min - buffer). Short: use the upside breach (max + buffer).
        if not is_short_trade and chg_value <= lower_exit:
            return f"chg_below_{timeframe.lower()}_{lower_exit:.1f}"
        if is_short_trade and chg_value >= upper_exit:
            return f"chg_above_{timeframe.lower()}_{upper_exit:.1f}"

        return None

    def informative_pairs(self):
        pairs = self.dp.current_whitelist()
        informative_pairs = [(pair, '30m') for pair in pairs]
        informative_pairs += [(pair, '1h') for pair in pairs]
        informative_pairs += [(pair, self.informative_timeframe) for pair in pairs]
        return informative_pairs

    @informative('30m')
    def populate_indicators_30m(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        
        # Basic Indicators  
        dataframe["rsi"] = ta.RSI(dataframe)

        # DI logic for "DI_catch"
        di_values = ta.PLUS_DI(dataframe) - ta.MINUS_DI(dataframe)
        dataframe["DI_catch"] = np.where(di_values > 0, 0, 1)

        # Local Extrema (Order 5)
        maxima = np.zeros(len(dataframe))
        minima = np.zeros(len(dataframe))

        maxima[argrelextrema(dataframe["close"].values, np.greater, order=5)] = 1
        minima[argrelextrema(dataframe["close"].values, np.less, order=5)] = 1

        dataframe["maxima"] = maxima
        dataframe["minima"] = minima

        # Check if a minima/maxima occurred within the last 4 periods
        # Note: Logic remains '0' if a peak exists, '1' if no peak exists per your original code
        dataframe["maxima_check"] = (
            dataframe["maxima"].rolling(4).apply(lambda x: int((x != 1).all()), raw=True).fillna(0)
        )
        dataframe["minima_check"] = (
            dataframe["minima"].rolling(4).apply(lambda x: int((x != 1).all()), raw=True).fillna(0)
        )

        return dataframe
    
    @informative('1h')
    def populate_indicators_1h(self, dataframe: DataFrame, metadata: dict) -> DataFrame:

        # Basic Indicators  
        dataframe["rsi"] = ta.RSI(dataframe)

        # DI logic for "DI_catch"
        di_values = ta.PLUS_DI(dataframe) - ta.MINUS_DI(dataframe)
        dataframe["DI_catch"] = np.where(di_values > 0, 0, 1)

        # Local Extrema (Order 5)
        maxima = np.zeros(len(dataframe))
        minima = np.zeros(len(dataframe))

        maxima[argrelextrema(dataframe["close"].values, np.greater, order=5)] = 1
        minima[argrelextrema(dataframe["close"].values, np.less, order=5)] = 1

        dataframe["maxima"] = maxima
        dataframe["minima"] = minima

        # Check if a minima/maxima occurred within the last 4 periods
        # Note: Logic remains '0' if a peak exists, '1' if no peak exists per your original code
        dataframe["maxima_check"] = (
            dataframe["maxima"].rolling(4).apply(lambda x: int((x != 1).all()), raw=True).fillna(0)
        )
        dataframe["minima_check"] = (
            dataframe["minima"].rolling(4).apply(lambda x: int((x != 1).all()), raw=True).fillna(0)
        )

        return dataframe

    @informative('4h')
    def populate_indicators_4h(self, dataframe: DataFrame, metadata: dict) -> DataFrame:

        # Basic Indicators  
        dataframe["rsi"] = ta.RSI(dataframe)

        # DI logic for "DI_catch"
        di_values = ta.PLUS_DI(dataframe) - ta.MINUS_DI(dataframe)
        dataframe["DI_catch"] = np.where(di_values > 0, 0, 1)

        # Local Extrema (Order 5)
        maxima = np.zeros(len(dataframe))
        minima = np.zeros(len(dataframe))

        maxima[argrelextrema(dataframe["close"].values, np.greater, order=5)] = 1
        minima[argrelextrema(dataframe["close"].values, np.less, order=5)] = 1

        dataframe["maxima"] = maxima
        dataframe["minima"] = minima

        # Check if a minima/maxima occurred within the last 4 periods
        # Note: Logic remains '0' if a peak exists, '1' if no peak exists per your original code
        dataframe["maxima_check"] = (
            dataframe["maxima"].rolling(4).apply(lambda x: int((x != 1).all()), raw=True).fillna(0)
        )
        dataframe["minima_check"] = (
            dataframe["minima"].rolling(4).apply(lambda x: int((x != 1).all()), raw=True).fillna(0)
        )

        return dataframe

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:

        # Basic Indicators  
        dataframe["rsi"] = ta.RSI(dataframe)
        # 24h change on base timeframe candles (5m -> 288 candles per day).
        dataframe["chg_pct"] = np.where(
            dataframe["close"].shift(288) > 0,
            ((dataframe["close"] - dataframe["close"].shift(288)) / dataframe["close"].shift(288)) * 100,
            np.nan,
        )

        # DI logic for "DI_catch"
        di_values = ta.PLUS_DI(dataframe) - ta.MINUS_DI(dataframe)
        dataframe["DI_catch"] = np.where(di_values > 0, 0, 1)

        # Local Extrema (Order 5)
        maxima = np.zeros(len(dataframe))
        minima = np.zeros(len(dataframe))

        maxima[argrelextrema(dataframe["close"].values, np.greater, order=5)] = 1
        minima[argrelextrema(dataframe["close"].values, np.less, order=5)] = 1

        dataframe["maxima"] = maxima
        dataframe["minima"] = minima

        # Check if a minima/maxima occurred within the last 4 periods
        # Note: Logic remains '0' if a peak exists, '1' if no peak exists per your original code
        dataframe["maxima_check"] = (
            dataframe["maxima"].rolling(4).apply(lambda x: int((x != 1).all()), raw=True).fillna(0)
        )
        dataframe["minima_check"] = (
            dataframe["minima"].rolling(4).apply(lambda x: int((x != 1).all()), raw=True).fillna(0)
        )
                
        return dataframe

    def _notify_chg_in_range(self, df: DataFrame, metadata: dict) -> None:
        if not self.telegram_chg_alert_enabled or df.empty:
            return
        if not getattr(self, "dp", None):
            return

        pair = metadata.get("pair", "")
        if not pair:
            return

        last_candle = df.iloc[-1]
        chg_value = last_candle.get("chg_pct", np.nan)
        if pd.isna(chg_value):
            return

        chg_value = float(chg_value)
        if chg_value <= self.telegram_chg_min:
            zone = "below"
        elif chg_value >= self.telegram_chg_max:
            zone = "above"
        else:
            zone = "within"

        state = self.telegram_chg_alert_state.get(pair, {"zone": "within"})
        prev_zone = state.get("zone", "within")

        if zone != prev_zone and zone in {"below", "above"}:
            if zone == "below":
                msg = (
                    f"{pair} 24h chg% dropped below {self.telegram_chg_min:.2f}% -> {chg_value:.2f}%"
                )
            else:
                msg = (
                    f"{pair} 24h chg% rose above {self.telegram_chg_max:.2f}% -> {chg_value:.2f}%"
                )
            try:
                self.dp.send_msg(msg)
            except Exception as exception:
                logger.debug("Telegram chg alert failed for %s: %s", pair, exception)

        state["zone"] = zone
        self.telegram_chg_alert_state[pair] = state

    def populate_entry_trend(self, df: DataFrame, metadata: dict) -> DataFrame:

        self._notify_chg_in_range(df, metadata)

        chg_30m_ok = True
        chg_1h_ok = True
        chg_4h_ok = True
        if self.use_chg_filter:
            chg_30m_ok = (
                (df["chg_pct"] >= self.chg_30m_min) & (df["chg_pct"] <= self.chg_30m_max)
            ) if self.chg_30m_enabled else True
            chg_1h_ok = (
                (df["chg_pct"] >= self.chg_1h_min) & (df["chg_pct"] <= self.chg_1h_max)
            ) if self.chg_1h_enabled else True
            chg_4h_ok = (
                (df["chg_pct"] >= self.chg_4h_min) & (df["chg_pct"] <= self.chg_4h_max)
            ) if self.chg_4h_enabled else True

        # ===== LONG ENTRIES - 30M ONLY =====

        df.loc[
            (
                self.entry_30m_enabled
                &(df["minima_check_30m"] == 0)
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] < 30)
                & chg_30m_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 40)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "30M - Long")

        df.loc[
            (
                self.entry_30m_enabled
                &(df["DI_catch_30m"] == 1) 
                & (df["minima_check_30m"] == 0)
                & (df["minima_check_30m"].shift(1) == 1) 
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] < 30)
                & chg_30m_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 40)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "30M - Shift Long")        

        # ===== LONG ENTRIES - 1h ONLY =====

        df.loc[
            (
                self.entry_1h_enabled
                &(df["minima_check_1h"] == 0)
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] < 30)
                & chg_1h_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 40)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "1H - Long")

        df.loc[
            (
                self.entry_1h_enabled
                &(df["DI_catch_1h"] == 1) 
                & (df["minima_check_1h"] == 0)
                & (df["minima_check_1h"].shift(1) == 1) 
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] < 30)
                & chg_1h_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 40)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "1H - Shift Long")

        # ===== LONG ENTRIES - 4h ONLY =====

        df.loc[
            (
                self.entry_4h_enabled
                &(df["minima_check_4h"] == 0)
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] < 30)
                & chg_4h_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 40)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "4H - Long")

        df.loc[
            (
                self.entry_4h_enabled
                &(df["DI_catch_4h"] == 1) 
                & (df["minima_check_4h"] == 0)
                & (df["minima_check_4h"].shift(1) == 1) 
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] < 30)
                & chg_4h_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 40)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "4H - Shift Long")

        # ===== SHORT ENTRIES - 30m ONLY =====

        df.loc[
            (
                self.entry_30m_enabled
                &(df["maxima_check_30m"] == 0)
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] > 70)
                & chg_30m_ok
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > 60)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "30M - Short")

        df.loc[
            (
                self.entry_30m_enabled
                &(df["DI_catch_30m"] == 1) 
                & (df["maxima_check_30m"] == 0)
                & (df["maxima_check_30m"].shift(1) == 1) 
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] > 70)
                & chg_30m_ok
                & (df["maxima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] > 60)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "30M - Shift Short")

        # ===== SHORT ENTRIES - 1h ONLY =====

        df.loc[
            (
                self.entry_1h_enabled
                &
                (df["maxima_check_1h"] == 0)
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] > 70)
                & chg_1h_ok
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > 60)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "1H - Short")

        df.loc[
            (
                self.entry_1h_enabled
                &(df["DI_catch_1h"] == 1) 
                & (df["maxima_check_1h"] == 0)
                & (df["maxima_check_1h"].shift(1) == 1) 
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] > 70)
                & chg_1h_ok
                & (df["maxima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] > 60)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "1H - Shift Short")

        # ===== SHORT ENTRIES - 4h ONLY =====

        df.loc[
            (
                self.entry_4h_enabled
                &(df["maxima_check_4h"] == 0)
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] > 70)
                & chg_4h_ok
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > 60)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "4H - Short")

        df.loc[
            (
                self.entry_4h_enabled
                &(df["DI_catch_4h"] == 1)
                &(df["maxima_check_4h"] == 0)
                & (df["maxima_check_4h"].shift(1) == 1)
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] > 70)
                & chg_4h_ok
                & (df["maxima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] > 60)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "4H - Shift Short")

        return df

    def populate_exit_trend(self, df: DataFrame, metadata: dict) -> DataFrame:

        df.loc[((df["maxima_check"] == 0) & (df["volume"] > 0)), ["exit_long", "exit_tag"]] = (
            1,
            "Long Exit",
        )
        
        df.loc[((df["minima_check"] == 0) & (df["volume"] > 0)), ["exit_short", "exit_tag"]] = (
            1,
            "Short Exit",
        )

        return df