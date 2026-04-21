-- Seed 30 agents: 6 strategies x 5 personalities
-- Parameters are JSON: stop_loss_pct, take_profit_pct, position_size_pct, max_hold_days, plus strategy-specific params

-- Momentum agents
-- entry_threshold scales min momentum: 0.02 * threshold (e.g. 0.50 → 1.0% min)
INSERT OR IGNORE INTO agents (id, strategy, personality, params) VALUES
('momentum-aggressive', 'momentum', 'aggressive', '{"stop_loss_pct":0.02,"take_profit_pct":0.04,"position_size_pct":0.15,"max_hold_days":3,"lookback_days":20,"entry_threshold":0.50}'),
('momentum-conservative', 'momentum', 'conservative', '{"stop_loss_pct":0.05,"take_profit_pct":0.10,"position_size_pct":0.08,"max_hold_days":10,"lookback_days":20,"entry_threshold":0.60}'),
('momentum-fast', 'momentum', 'fast', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.12,"max_hold_days":2,"lookback_days":10,"entry_threshold":0.40}'),
('momentum-slow', 'momentum', 'slow', '{"stop_loss_pct":0.04,"take_profit_pct":0.08,"position_size_pct":0.10,"max_hold_days":10,"lookback_days":30,"entry_threshold":0.65}'),
('momentum-balanced', 'momentum', 'balanced', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.10,"max_hold_days":5,"lookback_days":20,"entry_threshold":0.50}');

-- Mean Reversion agents
-- entry_rsi raised to 35-45 range so signals trigger more frequently
INSERT OR IGNORE INTO agents (id, strategy, personality, params) VALUES
('meanrev-aggressive', 'mean_reversion', 'aggressive', '{"stop_loss_pct":0.02,"take_profit_pct":0.04,"position_size_pct":0.15,"max_hold_days":3,"rsi_period":14,"entry_rsi":42,"exit_rsi":55}'),
('meanrev-conservative', 'mean_reversion', 'conservative', '{"stop_loss_pct":0.05,"take_profit_pct":0.10,"position_size_pct":0.08,"max_hold_days":10,"rsi_period":14,"entry_rsi":35,"exit_rsi":55}'),
('meanrev-fast', 'mean_reversion', 'fast', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.12,"max_hold_days":2,"rsi_period":7,"entry_rsi":40,"exit_rsi":50}'),
('meanrev-slow', 'mean_reversion', 'slow', '{"stop_loss_pct":0.04,"take_profit_pct":0.08,"position_size_pct":0.10,"max_hold_days":10,"rsi_period":21,"entry_rsi":38,"exit_rsi":55}'),
('meanrev-balanced', 'mean_reversion', 'balanced', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.10,"max_hold_days":5,"rsi_period":14,"entry_rsi":40,"exit_rsi":55}');

-- Trend Following agents (unchanged — logic is sound, should fire in trending markets)
INSERT OR IGNORE INTO agents (id, strategy, personality, params) VALUES
('trend-aggressive', 'trend_following', 'aggressive', '{"stop_loss_pct":0.02,"take_profit_pct":0.04,"position_size_pct":0.15,"max_hold_days":3,"short_ma":5,"long_ma":20}'),
('trend-conservative', 'trend_following', 'conservative', '{"stop_loss_pct":0.05,"take_profit_pct":0.10,"position_size_pct":0.08,"max_hold_days":10,"short_ma":20,"long_ma":50}'),
('trend-fast', 'trend_following', 'fast', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.12,"max_hold_days":2,"short_ma":5,"long_ma":15}'),
('trend-slow', 'trend_following', 'slow', '{"stop_loss_pct":0.04,"take_profit_pct":0.08,"position_size_pct":0.10,"max_hold_days":10,"short_ma":20,"long_ma":60}'),
('trend-balanced', 'trend_following', 'balanced', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.10,"max_hold_days":5,"short_ma":10,"long_ma":30}');

-- Volatility Breakout agents
-- volume_threshold lowered; code now also accepts prices near (not just above) upper BB
INSERT OR IGNORE INTO agents (id, strategy, personality, params) VALUES
('volbreak-aggressive', 'volatility_breakout', 'aggressive', '{"stop_loss_pct":0.02,"take_profit_pct":0.04,"position_size_pct":0.15,"max_hold_days":3,"bb_period":20,"bb_std":2.0,"volume_threshold":1.2}'),
('volbreak-conservative', 'volatility_breakout', 'conservative', '{"stop_loss_pct":0.05,"take_profit_pct":0.10,"position_size_pct":0.08,"max_hold_days":10,"bb_period":20,"bb_std":2.5,"volume_threshold":1.5}'),
('volbreak-fast', 'volatility_breakout', 'fast', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.12,"max_hold_days":2,"bb_period":10,"bb_std":1.5,"volume_threshold":1.1}'),
('volbreak-slow', 'volatility_breakout', 'slow', '{"stop_loss_pct":0.04,"take_profit_pct":0.08,"position_size_pct":0.10,"max_hold_days":10,"bb_period":30,"bb_std":2.0,"volume_threshold":1.4}'),
('volbreak-balanced', 'volatility_breakout', 'balanced', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.10,"max_hold_days":5,"bb_period":20,"bb_std":2.0,"volume_threshold":1.2}');

-- Sector Rotation agents (unchanged — logic is sound)
INSERT OR IGNORE INTO agents (id, strategy, personality, params) VALUES
('sectrot-aggressive', 'sector_rotation', 'aggressive', '{"stop_loss_pct":0.02,"take_profit_pct":0.04,"position_size_pct":0.15,"max_hold_days":3,"rotation_lookback":10,"top_n_sectors":2}'),
('sectrot-conservative', 'sector_rotation', 'conservative', '{"stop_loss_pct":0.05,"take_profit_pct":0.10,"position_size_pct":0.08,"max_hold_days":10,"rotation_lookback":30,"top_n_sectors":3}'),
('sectrot-fast', 'sector_rotation', 'fast', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.12,"max_hold_days":2,"rotation_lookback":5,"top_n_sectors":1}'),
('sectrot-slow', 'sector_rotation', 'slow', '{"stop_loss_pct":0.04,"take_profit_pct":0.08,"position_size_pct":0.10,"max_hold_days":10,"rotation_lookback":30,"top_n_sectors":3}'),
('sectrot-balanced', 'sector_rotation', 'balanced', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.10,"max_hold_days":5,"rotation_lookback":20,"top_n_sectors":2}');

-- Value agents (params unchanged — code now has price-based fallback when KV data is missing)
INSERT OR IGNORE INTO agents (id, strategy, personality, params) VALUES
('value-aggressive', 'value', 'aggressive', '{"stop_loss_pct":0.02,"take_profit_pct":0.04,"position_size_pct":0.15,"max_hold_days":5,"pe_threshold_pctile":0.25,"min_dividend_yield":0.015}'),
('value-conservative', 'value', 'conservative', '{"stop_loss_pct":0.05,"take_profit_pct":0.10,"position_size_pct":0.08,"max_hold_days":14,"pe_threshold_pctile":0.20,"min_dividend_yield":0.025}'),
('value-fast', 'value', 'fast', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.12,"max_hold_days":3,"pe_threshold_pctile":0.30,"min_dividend_yield":0.01}'),
('value-slow', 'value', 'slow', '{"stop_loss_pct":0.04,"take_profit_pct":0.08,"position_size_pct":0.10,"max_hold_days":14,"pe_threshold_pctile":0.20,"min_dividend_yield":0.02}'),
('value-balanced', 'value', 'balanced', '{"stop_loss_pct":0.03,"take_profit_pct":0.06,"position_size_pct":0.10,"max_hold_days":7,"pe_threshold_pctile":0.25,"min_dividend_yield":0.02}');
