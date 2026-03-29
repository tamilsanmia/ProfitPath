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
    informative,
    stoploss_from_open,
)
from scipy.signal import argrelextrema
import pandas as pd

warnings.simplefilter(action="ignore", category=pd.errors.PerformanceWarning)

class BotPrimeX(IStrategy):
    max_dca_multiplier = 1
    # Base strategy timeframes
    use_custom_stoploss = True
    timeframe = "5m"
    informative_timeframe = "4h"

    # Strategy/runtime settings
    process_only_new_candles = True
    startup_candle_count: int = 200
    can_short = True
    use_exit_signal = True

    # Core trade behavior
    exit_profit_only = True
    trailing_stop = False
    position_adjustment_enable = False
    ignore_roi_if_entry_signal = True
    max_entry_position_adjustment = 2
    max_dca_orders_open = 2

    # Risk settings
    stoploss = -0.99
    dca_stoploss = -0.5
    leverage_value = 5

    # Stake allocation ratios (portion of proposed stake)
    initial_entry_stake_ratio = 0.5
    dca_entry_stake_ratio = 0.5

    # Shift signal lookback 
    shift_lookback = 5

    # 5m RSI thresholds for higher timeframe entry checks
    entry_5m_rsi_long_15m = 30
    entry_5m_rsi_short_15m = 70
    entry_5m_rsi_long_30m = 40
    entry_5m_rsi_short_30m = 60
    entry_5m_rsi_long_1h = 40
    entry_5m_rsi_short_1h = 60
    entry_5m_rsi_long_4h = 40
    entry_5m_rsi_short_4h = 60

    # ── DCA Settings ──────────────────────────────────────────────────────
    # DCA 1: profit window for 1st DCA re-entry (ratio, e.g. -0.15 = -15%)
    dca_reentry_min_profit = -0.15
    dca_reentry_max_drawdown = -0.5
    # DCA 2: profit window for 2nd DCA re-entry
    dca2_reentry_min_profit = -0.3
    dca2_reentry_max_drawdown = -0.5
    # Volatility guard: block DCA when 24h-change spikes within recent candles
    dca_sudden_chg_guard_enabled = True
    dca_sudden_chg_threshold = 5
    dca_sudden_chg_lookback = 10

    # ── 24h Change Filter (global) ────────────────────────────────────────
    use_chg_filter = True
    use_chg_exit_buffer = True

    # ── Telegram Alerts ───────────────────────────────────────────────────
    telegram_chg_alert_enabled = True
    telegram_chg_min = -5
    telegram_chg_max = 5
    telegram_chg_alert_state: Dict[str, Dict[str, Any]] = {}

    # ══════════════════════════════════════════════════════════════════════
    # PER-TIMEFRAME SETTINGS
    # Each timeframe block contains:
    #   entry signals  : long / shift_long / short / shift_short on/off
    #   24h chg entry  : min/max range & enabled toggle
    #   24h chg DCA    : min/max range for DCA re-entry
    #   exit buffer    : extra margin beyond chg range to force-exit & toggle
    # ══════════════════════════════════════════════════════════════════════

    # ── 5m ────────────────────────────────────────────────────────────────
    entry_5m_long_enabled = True
    entry_5m_shift_long_enabled = True
    entry_5m_short_enabled = True
    entry_5m_shift_short_enabled = True
    entry_5m_rsi_long = 30
    entry_5m_rsi_short = 70
    chg_5m_enabled = True
    chg_5m_min = -10
    chg_5m_max = 10
    dca_chg_5m_min = -10
    dca_chg_5m_max = 10
    chg_5m_exit_buffer_enabled = True
    chg_5m_exit_buffer = 2

    # ── 15m ───────────────────────────────────────────────────────────────
    entry_15m_long_enabled = False
    entry_15m_shift_long_enabled = False
    entry_15m_short_enabled = False
    entry_15m_shift_short_enabled = False
    entry_15m_rsi_long = 30
    entry_15m_rsi_short = 70
    chg_15m_enabled = True
    chg_15m_min = -10
    chg_15m_max = 10
    dca_chg_15m_min = -10
    dca_chg_15m_max = 10
    chg_15m_exit_buffer_enabled = True
    chg_15m_exit_buffer = 2

    # ── 30m ───────────────────────────────────────────────────────────────
    entry_30m_long_enabled = False
    entry_30m_shift_long_enabled = False
    entry_30m_short_enabled = False
    entry_30m_shift_short_enabled = False
    entry_30m_rsi_long = 30
    entry_30m_rsi_short = 70
    chg_30m_enabled = True
    chg_30m_min = -10
    chg_30m_max = 10
    dca_chg_30m_min = -10
    dca_chg_30m_max = 10
    chg_30m_exit_buffer_enabled = True
    chg_30m_exit_buffer = 2

    # ── 1h ────────────────────────────────────────────────────────────────
    entry_1h_long_enabled = False
    entry_1h_shift_long_enabled = False
    entry_1h_short_enabled = False
    entry_1h_shift_short_enabled = False
    entry_1h_rsi_long = 30
    entry_1h_rsi_short = 70
    chg_1h_enabled = True
    chg_1h_min = -10
    chg_1h_max = 10
    dca_chg_1h_min = -10
    dca_chg_1h_max = 10
    chg_1h_exit_buffer_enabled = True
    chg_1h_exit_buffer = 2

    # ── 4h ────────────────────────────────────────────────────────────────
    entry_4h_long_enabled = False
    entry_4h_shift_long_enabled = False
    entry_4h_short_enabled = False
    entry_4h_shift_short_enabled = False
    entry_4h_rsi_long = 30
    entry_4h_rsi_short = 70
    chg_4h_enabled = True
    chg_4h_min = -10
    chg_4h_max = 10
    dca_chg_4h_min = -10
    dca_chg_4h_max = 10
    chg_4h_exit_buffer_enabled = True
    chg_4h_exit_buffer = 2

    # Custom Functions
    increment = 1.001

    # Protections
    cooldown_lookback = 1
    stop_duration = 4
    use_stop_protection = True

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

    def _is_tf_enabled(self, tf: str) -> bool:
        """Return True if any signal type is enabled for the given timeframe."""
        prefix = f"entry_{tf}_"
        return any(
            getattr(self, prefix + s, False)
            for s in ("long_enabled", "shift_long_enabled", "short_enabled", "shift_short_enabled")
        )

    @property
    def plot_config(self):
        rsi_plots = {"rsi": {"color": "#1f77b4", "type": "line"}}
        tf_rsi = {
            "15m": ("rsi_15m", "#9467bd"),
            "30m": ("rsi_30m", "#ff520e"),
            "1h": ("rsi_1h", "#ff7f0e"),
            "4h": ("rsi_4h", "#2ca02c"),
        }
        for tf, (col, color) in tf_rsi.items():
            if self._is_tf_enabled(tf):
                rsi_plots[col] = {"color": color, "type": "line", "secondary_y": False}
        return {
            "main_plot": {},
            "subplots": {
                "RSI": rsi_plots,
                "24H CHG %": {"chg_pct": {"color": "#d62728", "type": "line"}},
            },
        }

    @property
    def protections(self):
        prot = []
        prot.append(
            {"method": "CooldownPeriod", "stop_duration_candles": self.cooldown_lookback}
        )
        if self.use_stop_protection:
            prot.append(
                {
                    "method": "StoplossGuard",
                    "lookback_period_candles": 24 * 3,
                    "trade_limit": 2,
                    "stop_duration_candles": self.stop_duration,
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
            entry_price *= self.increment
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

        # Allow up to max_entry_position_adjustment DCA re-entries per trade.
        if count_of_entries > self.max_entry_position_adjustment:
            return None

        # Pairlist-wide DCA limit: only N DCA orders open at a time.
        if self.max_dca_orders_open > 0:
            trades_with_dca = sum(
                1 for t in Trade.get_trades_proxy(is_open=True)
                if t.nr_of_successful_entries > 1
            )
            if trades_with_dca >= self.max_dca_orders_open:
                return None

        # Re-entry is allowed only between configured min/max DCA profit bounds.
        if count_of_entries == 1:
            min_profit = self.dca_reentry_min_profit
            max_drawdown = self.dca_reentry_max_drawdown
        else:
            min_profit = self.dca2_reentry_min_profit
            max_drawdown = self.dca2_reentry_max_drawdown
        if current_profit > min_profit or current_profit < max_drawdown:
            return None

        if not filled_entries or dataframe.empty:
            return None

        # Volatility guard over the last 10 candles.
        # Long: block DCA on sudden upward move. Short: block DCA on sudden downward move.
        if self.dca_sudden_chg_guard_enabled:
            recent_chg = dataframe["chg_pct"].tail(self.dca_sudden_chg_lookback).dropna()
            if len(recent_chg) >= 2:
                threshold = float(self.dca_sudden_chg_threshold)
                latest_chg = float(recent_chg.iloc[-1])
                chg_sudden_increase = (latest_chg - float(recent_chg.min())) >= threshold
                chg_sudden_decrease = (float(recent_chg.max()) - latest_chg) >= threshold

                is_short_trade = bool(getattr(trade, "is_short", False))
                if (not is_short_trade and chg_sudden_increase) or (is_short_trade and chg_sudden_decrease):
                    return None

        last_candle = dataframe.iloc[-1]
        shifted_candle = dataframe.iloc[-(self.shift_lookback + 1)] if len(dataframe) >= (self.shift_lookback + 1) else None
        is_short_trade = bool(getattr(trade, "is_short", False))
        entry_tag = (getattr(trade, "enter_tag", "") or "").strip()

        def chg_ok(column_name: str, min_value: float, max_value: float, enabled: bool = True) -> bool:
            if not self.use_chg_filter or not enabled:
                return True
            value = last_candle.get(column_name, 0)
            return min_value <= value <= max_value

        if is_short_trade:
            signal_by_tag = {
                "5M - Short": self.entry_5m_short_enabled and (
                    last_candle.get("maxima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_5m_min, self.dca_chg_5m_max, self.chg_5m_enabled)
                ),
                "5M - Shift Short": self.entry_5m_shift_short_enabled and (
                    last_candle.get("DI_catch", 0) == 0
                    and last_candle.get("maxima_check", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_5m_min, self.dca_chg_5m_max, self.chg_5m_enabled)
                ),
                "15M - Short": self.entry_15m_short_enabled and (
                    last_candle.get("maxima_check_15m", 1) == 0
                    and last_candle.get("volume_15m", 0) > 0
                    and last_candle.get("rsi_15m", 0) > self.entry_15m_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_15m_min, self.dca_chg_15m_max, self.chg_15m_enabled)
                    and last_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short_15m
                ),
                "15M - Shift Short": self.entry_15m_shift_short_enabled and (
                    last_candle.get("DI_catch_15m", 0) == 0
                    and last_candle.get("maxima_check_15m", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume_15m", 0) > 0
                    and last_candle.get("rsi_15m", 0) > self.entry_15m_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_15m_min, self.dca_chg_15m_max, self.chg_15m_enabled)
                    and last_candle.get("maxima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short_15m
                ),
                "30M - Short": self.entry_30m_short_enabled and (
                    last_candle.get("maxima_check_30m", 1) == 0
                    and last_candle.get("volume_30m", 0) > 0
                    and last_candle.get("rsi_30m", 0) > self.entry_30m_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_30m_min, self.dca_chg_30m_max, self.chg_30m_enabled)
                    and last_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short_30m
                ),
                "30M - Shift Short": self.entry_30m_shift_short_enabled and (
                    last_candle.get("DI_catch_30m", 0) == 0
                    and last_candle.get("maxima_check_30m", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume_30m", 0) > 0
                    and last_candle.get("rsi_30m", 0) > self.entry_30m_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_30m_min, self.dca_chg_30m_max, self.chg_30m_enabled)
                    and last_candle.get("maxima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short_30m
                ),
                "1H - Short": self.entry_1h_short_enabled and (
                    last_candle.get("maxima_check_1h", 1) == 0
                    and last_candle.get("volume_1h", 0) > 0
                    and last_candle.get("rsi_1h", 0) > self.entry_1h_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_1h_min, self.dca_chg_1h_max, self.chg_1h_enabled)
                    and last_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short_1h
                ),
                "1H - Shift Short": self.entry_1h_shift_short_enabled and (
                    last_candle.get("DI_catch_1h", 0) == 0
                    and last_candle.get("maxima_check_1h", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume_1h", 0) > 0
                    and last_candle.get("rsi_1h", 0) > self.entry_1h_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_1h_min, self.dca_chg_1h_max, self.chg_1h_enabled)
                    and last_candle.get("maxima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short_1h
                ),
                "4H - Short": self.entry_4h_short_enabled and (
                    last_candle.get("maxima_check_4h", 1) == 0
                    and last_candle.get("volume_4h", 0) > 0
                    and last_candle.get("rsi_4h", 0) > self.entry_4h_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_4h_min, self.dca_chg_4h_max, self.chg_4h_enabled)
                    and last_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short_4h
                ),
                "4H - Shift Short": self.entry_4h_shift_short_enabled and (
                    last_candle.get("DI_catch_4h", 0) == 0
                    and last_candle.get("maxima_check_4h", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("maxima_check", 0) == 1
                    and last_candle.get("volume_4h", 0) > 0
                    and last_candle.get("rsi_4h", 0) > self.entry_4h_rsi_short
                    and chg_ok("chg_pct", self.dca_chg_4h_min, self.dca_chg_4h_max, self.chg_4h_enabled)
                    and last_candle.get("maxima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 0) > self.entry_5m_rsi_short_4h
                ),
            }
        else:
            signal_by_tag = {
                "5M - Long": self.entry_5m_long_enabled and (
                    last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_5m_min, self.dca_chg_5m_max, self.chg_5m_enabled)
                ),
                "5M - Shift Long": self.entry_5m_shift_long_enabled and (
                    last_candle.get("DI_catch", 0) == 1
                    and last_candle.get("minima_check", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("minima_check", 0) == 1
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_5m_min, self.dca_chg_5m_max, self.chg_5m_enabled)
                ),
                "15M - Long": self.entry_15m_long_enabled and (
                    last_candle.get("minima_check_15m", 1) == 0
                    and last_candle.get("volume_15m", 0) > 0
                    and last_candle.get("rsi_15m", 100) < self.entry_15m_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_15m_min, self.dca_chg_15m_max, self.chg_15m_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long_15m
                ),
                "15M - Shift Long": self.entry_15m_shift_long_enabled and (
                    last_candle.get("DI_catch_15m", 0) == 1
                    and last_candle.get("minima_check_15m", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("minima_check", 0) == 1
                    and last_candle.get("volume_15m", 0) > 0
                    and last_candle.get("rsi_15m", 100) < self.entry_15m_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_15m_min, self.dca_chg_15m_max, self.chg_15m_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long_15m
                ),
                "30M - Long": self.entry_30m_long_enabled and (
                    last_candle.get("minima_check_30m", 1) == 0
                    and last_candle.get("volume_30m", 0) > 0
                    and last_candle.get("rsi_30m", 100) < self.entry_30m_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_30m_min, self.dca_chg_30m_max, self.chg_30m_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long_30m
                ),
                "30M - Shift Long": self.entry_30m_shift_long_enabled and (
                    last_candle.get("DI_catch_30m", 0) == 1
                    and last_candle.get("minima_check_30m", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("minima_check", 0) == 1
                    and last_candle.get("volume_30m", 0) > 0
                    and last_candle.get("rsi_30m", 100) < self.entry_30m_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_30m_min, self.dca_chg_30m_max, self.chg_30m_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long_30m
                ),
                "1H - Long": self.entry_1h_long_enabled and (
                    last_candle.get("minima_check_1h", 1) == 0
                    and last_candle.get("volume_1h", 0) > 0
                    and last_candle.get("rsi_1h", 100) < self.entry_1h_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_1h_min, self.dca_chg_1h_max, self.chg_1h_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long_1h
                ),
                "1H - Shift Long": self.entry_1h_shift_long_enabled and (
                    last_candle.get("DI_catch_1h", 0) == 1
                    and last_candle.get("minima_check_1h", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("minima_check", 0) == 1
                    and last_candle.get("volume_1h", 0) > 0
                    and last_candle.get("rsi_1h", 100) < self.entry_1h_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_1h_min, self.dca_chg_1h_max, self.chg_1h_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long_1h
                ),
                "4H - Long": self.entry_4h_long_enabled and (
                    last_candle.get("minima_check_4h", 1) == 0
                    and last_candle.get("volume_4h", 0) > 0
                    and last_candle.get("rsi_4h", 100) < self.entry_4h_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_4h_min, self.dca_chg_4h_max, self.chg_4h_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long_4h
                ),
                "4H - Shift Long": self.entry_4h_shift_long_enabled and (
                    last_candle.get("DI_catch_4h", 0) == 1
                    and last_candle.get("minima_check_4h", 1) == 0
                    and shifted_candle is not None
                    and shifted_candle.get("minima_check", 0) == 1
                    and last_candle.get("volume_4h", 0) > 0
                    and last_candle.get("rsi_4h", 100) < self.entry_4h_rsi_long
                    and chg_ok("chg_pct", self.dca_chg_4h_min, self.dca_chg_4h_max, self.chg_4h_enabled)
                    and last_candle.get("minima_check", 1) == 0
                    and last_candle.get("volume", 0) > 0
                    and last_candle.get("rsi", 100) < self.entry_5m_rsi_long_4h
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
            # Reuse the initial filled-entry size, with optional geometric scaling when configured.
            stake_amount = filled_entries[0].cost
            scale_setting = getattr(self, "safety_order_volume_scale", 1.0)
            dca_scale = float(getattr(scale_setting, "value", scale_setting)) ** (count_of_entries - 1)
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
            "5M": (self.chg_5m_min, self.chg_5m_max),
            "15M": (self.chg_15m_min, self.chg_15m_max),
            "30M": (self.chg_30m_min, self.chg_30m_max),
            "1H": (self.chg_1h_min, self.chg_1h_max),
            "4H": (self.chg_4h_min, self.chg_4h_max),
        }
        buffers_by_tf = {
            "5M": self.chg_5m_exit_buffer,
            "15M": self.chg_15m_exit_buffer,
            "30M": self.chg_30m_exit_buffer,
            "1H": self.chg_1h_exit_buffer,
            "4H": self.chg_4h_exit_buffer,
        }
        buffer_enabled_by_tf = {
            "5M": self.chg_5m_exit_buffer_enabled,
            "15M": self.chg_15m_exit_buffer_enabled,
            "30M": self.chg_30m_exit_buffer_enabled,
            "1H": self.chg_1h_exit_buffer_enabled,
            "4H": self.chg_4h_exit_buffer_enabled,
        }
        bounds = bounds_by_tf.get(timeframe)
        if not bounds:
            return None
        if not self.use_chg_exit_buffer or not buffer_enabled_by_tf.get(timeframe, True):
            return None
        else:
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
        informative_pairs = []
        if self._is_tf_enabled("15m"):
            informative_pairs += [(pair, '15m') for pair in pairs]
        if self._is_tf_enabled("30m"):
            informative_pairs += [(pair, '30m') for pair in pairs]
        if self._is_tf_enabled("1h"):
            informative_pairs += [(pair, '1h') for pair in pairs]
        if self._is_tf_enabled("4h"):
            informative_pairs += [(pair, self.informative_timeframe) for pair in pairs]
        return informative_pairs

    @informative('15m')
    def populate_indicators_15m(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        if not self._is_tf_enabled("15m"):
            for col in ("rsi", "DI_catch", "maxima", "minima"):
                dataframe[col] = 0
            dataframe["maxima_check"] = 1
            dataframe["minima_check"] = 1
            return dataframe

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

    @informative('30m')
    def populate_indicators_30m(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        if not self._is_tf_enabled("30m"):
            for col in ("rsi", "DI_catch", "maxima", "minima"):
                dataframe[col] = 0
            dataframe["maxima_check"] = 1
            dataframe["minima_check"] = 1
            return dataframe

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
        if not self._is_tf_enabled("1h"):
            for col in ("rsi", "DI_catch", "maxima", "minima"):
                dataframe[col] = 0
            dataframe["maxima_check"] = 1
            dataframe["minima_check"] = 1
            return dataframe

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
        if not self._is_tf_enabled("4h"):
            for col in ("rsi", "DI_catch", "maxima", "minima"):
                dataframe[col] = 0
            dataframe["maxima_check"] = 1
            dataframe["minima_check"] = 1
            return dataframe

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

        chg_5m_ok = True
        chg_15m_ok = True
        chg_30m_ok = True
        chg_1h_ok = True
        chg_4h_ok = True
        if self.use_chg_filter:
            chg_5m_ok = (
                (df["chg_pct"] >= self.chg_5m_min) & (df["chg_pct"] <= self.chg_5m_max)
            ) if self.chg_5m_enabled else True
            chg_15m_ok = (
                (df["chg_pct"] >= self.chg_15m_min) & (df["chg_pct"] <= self.chg_15m_max)
            ) if self.chg_15m_enabled else True
            chg_30m_ok = (
                (df["chg_pct"] >= self.chg_30m_min) & (df["chg_pct"] <= self.chg_30m_max)
            ) if self.chg_30m_enabled else True
            chg_1h_ok = (
                (df["chg_pct"] >= self.chg_1h_min) & (df["chg_pct"] <= self.chg_1h_max)
            ) if self.chg_1h_enabled else True
            chg_4h_ok = (
                (df["chg_pct"] >= self.chg_4h_min) & (df["chg_pct"] <= self.chg_4h_max)
            ) if self.chg_4h_enabled else True

        # ===== LONG ENTRIES - 5m ONLY =====

        df.loc[
            (
                self.entry_5m_long_enabled
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long)
                & chg_5m_ok
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "5M - Long")

        df.loc[
            (
                self.entry_5m_shift_long_enabled
                & (df["DI_catch"] == 1)
                & (df["minima_check"] == 0)
                & (df["minima_check"].shift(self.shift_lookback) == 1)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long)
                & chg_5m_ok
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "5M - Shift Long")

        # ===== LONG ENTRIES - 15m ONLY =====

        df.loc[
            (
                self.entry_15m_long_enabled
                & (df["minima_check_15m"] == 0)
                & (df["volume_15m"] > 0)
                & (df["rsi_15m"] < self.entry_15m_rsi_long)
                & chg_15m_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long_15m)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "15M - Long")

        df.loc[
            (
                self.entry_15m_shift_long_enabled
                & (df["DI_catch_15m"] == 1)
                & (df["minima_check_15m"] == 0)
                & (df["minima_check"].shift(self.shift_lookback) == 1)
                & (df["volume_15m"] > 0)
                & (df["rsi_15m"] < self.entry_15m_rsi_long)
                & chg_15m_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long_15m)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "15M - Shift Long")

        # ===== LONG ENTRIES - 30M ONLY =====

        df.loc[
            (
                self.entry_30m_long_enabled
                &(df["minima_check_30m"] == 0)
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] < self.entry_30m_rsi_long)
                & chg_30m_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long_30m)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "30M - Long")

        df.loc[
            (
                self.entry_30m_shift_long_enabled
                &(df["DI_catch_30m"] == 1) 
                & (df["minima_check_30m"] == 0)
                & (df["minima_check"].shift(self.shift_lookback) == 1) 
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] < self.entry_30m_rsi_long)
                & chg_30m_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long_30m)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "30M - Shift Long")        

        # ===== LONG ENTRIES - 1h ONLY =====

        df.loc[
            (
                self.entry_1h_long_enabled
                &(df["minima_check_1h"] == 0)
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] < self.entry_1h_rsi_long)
                & chg_1h_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long_1h)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "1H - Long")

        df.loc[
            (
                self.entry_1h_shift_long_enabled
                &(df["DI_catch_1h"] == 1) 
                & (df["minima_check_1h"] == 0)
                & (df["minima_check"].shift(self.shift_lookback) == 1) 
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] < self.entry_1h_rsi_long)
                & chg_1h_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long_1h)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "1H - Shift Long")

        # ===== LONG ENTRIES - 4h ONLY =====

        df.loc[
            (
                self.entry_4h_long_enabled
                &(df["minima_check_4h"] == 0)
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] < self.entry_4h_rsi_long)
                & chg_4h_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long_4h)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "4H - Long")

        df.loc[
            (
                self.entry_4h_shift_long_enabled
                &(df["DI_catch_4h"] == 1) 
                & (df["minima_check_4h"] == 0)
                & (df["minima_check"].shift(self.shift_lookback) == 1) 
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] < self.entry_4h_rsi_long)
                & chg_4h_ok
                & (df["minima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] < self.entry_5m_rsi_long_4h)
            ),
            ["enter_long", "enter_tag"],
        ] = (1, "4H - Shift Long")

        # ===== SHORT ENTRIES - 5m ONLY =====

        df.loc[
            (
                self.entry_5m_short_enabled
                & (df["maxima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short)
                & chg_5m_ok
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "5M - Short")

        df.loc[
            (
                self.entry_5m_shift_short_enabled
                & (df["DI_catch"] == 0)
                & (df["maxima_check"] == 0)
                & (df["maxima_check"].shift(self.shift_lookback) == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short)
                & chg_5m_ok
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "5M - Shift Short")

        # ===== SHORT ENTRIES - 15m ONLY =====

        df.loc[
            (
                self.entry_15m_short_enabled
                & (df["maxima_check_15m"] == 0)
                & (df["volume_15m"] > 0)
                & (df["rsi_15m"] > self.entry_15m_rsi_short)
                & chg_15m_ok
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short_15m)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "15M - Short")

        df.loc[
            (
                self.entry_15m_shift_short_enabled
                & (df["DI_catch_15m"] == 0)
                & (df["maxima_check_15m"] == 0)
                & (df["maxima_check"].shift(self.shift_lookback) == 1)
                & (df["volume_15m"] > 0)
                & (df["rsi_15m"] > self.entry_15m_rsi_short)
                & chg_15m_ok
                & (df["maxima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short_15m)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "15M - Shift Short")

        # ===== SHORT ENTRIES - 30m ONLY =====

        df.loc[
            (
                self.entry_30m_short_enabled
                &(df["maxima_check_30m"] == 0)
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] > self.entry_30m_rsi_short)
                & chg_30m_ok
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short_30m)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "30M - Short")

        df.loc[
            (
                self.entry_30m_shift_short_enabled
                &(df["DI_catch_30m"] == 0) 
                & (df["maxima_check_30m"] == 0)
                & (df["maxima_check"].shift(self.shift_lookback) == 1) 
                & (df["volume_30m"] > 0)
                & (df["rsi_30m"] > self.entry_30m_rsi_short)
                & chg_30m_ok
                & (df["maxima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short_30m)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "30M - Shift Short")

        # ===== SHORT ENTRIES - 1h ONLY =====

        df.loc[
            (
                self.entry_1h_short_enabled
                &
                (df["maxima_check_1h"] == 0)
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] > self.entry_1h_rsi_short)
                & chg_1h_ok
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short_1h)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "1H - Short")

        df.loc[
            (
                self.entry_1h_shift_short_enabled
                &(df["DI_catch_1h"] == 0) 
                & (df["maxima_check_1h"] == 0)
                & (df["maxima_check"].shift(self.shift_lookback) == 1) 
                & (df["volume_1h"] > 0)
                & (df["rsi_1h"] > self.entry_1h_rsi_short)
                & chg_1h_ok
                & (df["maxima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short_1h)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "1H - Shift Short")

        # ===== SHORT ENTRIES - 4h ONLY =====

        df.loc[
            (
                self.entry_4h_short_enabled
                &(df["maxima_check_4h"] == 0)
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] > self.entry_4h_rsi_short)
                & chg_4h_ok
                & (df["maxima_check"] == 1)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short_4h)
            ),
            ["enter_short", "enter_tag"],
        ] = (1, "4H - Short")

        df.loc[
            (
                self.entry_4h_shift_short_enabled
                &(df["DI_catch_4h"] == 0)
                &(df["maxima_check_4h"] == 0)
                & (df["maxima_check"].shift(self.shift_lookback) == 1)
                & (df["volume_4h"] > 0)
                & (df["rsi_4h"] > self.entry_4h_rsi_short)
                & chg_4h_ok
                & (df["maxima_check"] == 0)
                & (df["volume"] > 0)
                & (df["rsi"] > self.entry_5m_rsi_short_4h)
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
