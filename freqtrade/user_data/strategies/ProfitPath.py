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
    exit_profit_only = True
    trailing_stop = False
    position_adjustment_enable = True
    ignore_roi_if_entry_signal = True
    max_entry_position_adjustment = 1
    max_dca_multiplier = 1
    dca_reentry_loss_threshold = -0.15
    process_only_new_candles = True
    can_short = True
    use_exit_signal = True
    startup_candle_count: int = 200
    stoploss = -0.99
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
                "rsi": {"color": "#1f77b4", "type": "line"},
                "rsi_30m": {"color": "#ff520e", "type": "line", "secondary_y": False},
                "rsi_1h": {"color": "#ff7f0e", "type": "line", "secondary_y": False},
                "rsi_4h": {"color": "#2ca02c", "type": "line", "secondary_y": False},
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
        # Use 50% of wallet for initial entry, 50% for DCA orders (based on order number)
        trade = kwargs.get('trade')
        if trade is not None and hasattr(trade, 'nr_of_successful_entries'):
            if trade.nr_of_successful_entries == 0:
                return proposed_stake * 0.5  # Initial entry
            else:
                return proposed_stake * 0.5  # DCA order
        else:
            return proposed_stake * 0.5  # Default to initial entry if trade info is missing

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

        # Re-entry only when loss is at or below -15%.
        if current_profit > self.dca_reentry_loss_threshold:
            return None

        if not filled_entries or dataframe.empty:
            return None

        last_candle = dataframe.iloc[-1]
        is_short_trade = bool(getattr(trade, "is_short", False))

        if is_short_trade:
            # Maxima Full Send 30m
            signal_30m = (
                last_candle.get("maxima_check_30m", 1) == 0
                and last_candle.get("volume_30m", 0) > 0
                and last_candle.get("rsi_30m", 0) > 70
                and last_candle.get("maxima_check", 0) == 1
                and last_candle.get("volume", 0) > 0
                and last_candle.get("rsi", 0) > 70
            )
            # Maxima Full Send 1h
            signal_1h = (
                last_candle.get("maxima_check_1h", 1) == 0
                and last_candle.get("volume_1h", 0) > 0
                and last_candle.get("rsi_1h", 0) > 70
                and last_candle.get("maxima_check", 0) == 1
                and last_candle.get("volume", 0) > 0
                and last_candle.get("rsi", 0) > 60
            )
            # Maxima Full Send 4h
            signal_4h = (
                last_candle.get("maxima_check_4h", 1) == 0
                and last_candle.get("volume_4h", 0) > 0
                and last_candle.get("rsi_4h", 0) > 70
                and last_candle.get("maxima_check", 0) == 1
                and last_candle.get("volume", 0) > 0
                and last_candle.get("rsi", 0) > 60
            )
        else:
            # Minima Full Send 30m
            signal_30m = (
                last_candle.get("minima_check_30m", 1) == 0
                and last_candle.get("volume_30m", 0) > 0
                and last_candle.get("rsi_30m", 100) < 30
                and last_candle.get("minima_check", 1) == 0
                and last_candle.get("volume", 0) > 0
                and last_candle.get("rsi", 100) < 30
            )
            # Minima Full Send 1h
            signal_1h = (
                last_candle.get("minima_check_1h", 1) == 0
                and last_candle.get("volume_1h", 0) > 0
                and last_candle.get("rsi_1h", 100) < 30
                and last_candle.get("minima_check", 1) == 0
                and last_candle.get("volume", 0) > 0
                and last_candle.get("rsi", 100) < 40
            )
            # Minima Full Send 4h
            signal_4h = (
                last_candle.get("minima_check_4h", 1) == 0
                and last_candle.get("volume_4h", 0) > 0
                and last_candle.get("rsi_4h", 100) < 30
                and last_candle.get("minima_check", 1) == 0
                and last_candle.get("volume", 0) > 0
                and last_candle.get("rsi", 100) < 40
            )

        if not (signal_30m or signal_1h or signal_4h):
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
        # Fixed leverage mode: always request 5x, capped by exchange/pair max leverage.
        return max(min(5.0, max_leverage), 1.0)

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
            return stoploss_from_open(-0.5, current_profit)
        return self.stoploss

    def informative_pairs(self):
        pairs = self.dp.current_whitelist()
        informative_pairs = [(pair, '30m') for pair in pairs]
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

    def populate_entry_trend(self, df: DataFrame, metadata: dict) -> DataFrame:

        # ===== LONG ENTRIES - 30M ONLY =====

        df.loc[
            (
                (df["minima_check_30m"] == 0)
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] < 30)
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 30)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "30M - Long")

        # ===== LONG ENTRIES - 1h ONLY =====

        df.loc[
            (
                (df["minima_check_1h"] == 0)
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] < 30)
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 30)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "1H - Long")

        # ===== LONG ENTRIES - 4h ONLY =====

        df.loc[
            (
                (df["minima_check_4h"] == 0)
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] < 30)
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < 30)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "4H - Long")

        # ===== SHORT ENTRIES - 30m ONLY =====

        df.loc[
            (
                (df["maxima_check_30m"] == 0)
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] > 70)
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > 70)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "30M - Short")

        # ===== SHORT ENTRIES - 1h ONLY =====

        df.loc[
            (
                (df["maxima_check_1h"] == 0)
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] > 70)
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > 70)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "1H - Short")

        # ===== SHORT ENTRIES - 4h ONLY =====

        df.loc[
            (
                (df["maxima_check_4h"] == 0)
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] > 70)
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > 70)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "4H - Short")

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
