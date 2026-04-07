// Weekly LLM-powered strategy review using Workers AI

import * as db from './db.js';

export async function handleWeeklyReview(env) {
  const agents = await db.getActiveAgents(env.DB);
  const log = [];

  // Also include paused agents for review
  const { results: allAgents } = await env.DB.prepare(
    'SELECT * FROM agents'
  ).all();
  const agentList = allAgents.map(a => ({ ...a, params: JSON.parse(a.params) }));

  // Build performance summary for each agent
  const summaries = [];
  for (const agent of agentList) {
    const snapshots = await db.getSnapshots(env.DB, agent.id, 7);
    const recentTrades = await db.getRecentClosedTrades(env.DB, agent.id, 7);

    const weeklyPnl = snapshots.reduce((s, snap) => s + snap.daily_pnl, 0);
    const avgDailyPnl = snapshots.length > 0
      ? snapshots.reduce((s, snap) => s + snap.daily_pnl_pct, 0) / snapshots.length
      : 0;
    const avgAlpha = snapshots.length > 0
      ? snapshots.reduce((s, snap) => s + (snap.alpha || 0), 0) / snapshots.length
      : 0;
    const latestSnapshot = snapshots[snapshots.length - 1];
    const wins = recentTrades.filter(t => (t.pnl || 0) > 0).length;
    const winRate = recentTrades.length > 0 ? wins / recentTrades.length : null;

    summaries.push({
      id: agent.id,
      strategy: agent.strategy,
      personality: agent.personality,
      is_active: agent.is_active,
      paused_reason: agent.paused_reason,
      params: agent.params,
      weekly_pnl: weeklyPnl,
      avg_daily_pnl_pct: avgDailyPnl,
      avg_alpha: avgAlpha,
      sharpe: latestSnapshot?.sharpe_ratio || null,
      max_drawdown: latestSnapshot?.max_drawdown || null,
      win_rate: winRate,
      trades_this_week: recentTrades.length,
      cumulative_pnl: latestSnapshot?.cumulative_pnl || 0,
    });
  }

  // Get SPY weekly return for context
  const spySnapshots = summaries.length > 0
    ? await db.getSnapshots(env.DB, summaries[0].id, 7)
    : [];
  const spyWeeklyPct = spySnapshots.reduce((s, snap) => s + (snap.spy_daily_pct || 0), 0);

  // Build prompt for LLM
  const prompt = buildReviewPrompt(summaries, spyWeeklyPct);

  // Call Workers AI
  let llmResponse;
  try {
    const result = await env.AI.run('@cf/meta/llama-3.1-70b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2000,
    });
    llmResponse = result.response;
    log.push('LLM review completed');
  } catch (e) {
    log.push(`LLM call failed: ${e.message}`);
    return { skipped: true, reason: `LLM error: ${e.message}`, log };
  }

  // Parse LLM response for parameter adjustments
  const adjustments = parseAdjustments(llmResponse);
  log.push(`Parsed ${adjustments.length} adjustment suggestions`);

  // Apply high-confidence adjustments
  let applied = 0;
  for (const adj of adjustments) {
    if (adj.confidence !== 'high') {
      log.push(`Skipping ${adj.agent_id}: confidence=${adj.confidence}`);
      continue;
    }

    const agent = agentList.find(a => a.id === adj.agent_id);
    if (!agent) continue;

    const newParams = { ...agent.params, ...adj.param_changes };

    // Validate params are reasonable
    if (!validateParams(newParams)) {
      log.push(`Invalid params for ${adj.agent_id}, skipping`);
      continue;
    }

    await db.updateAgentParams(env.DB, adj.agent_id, newParams);
    await db.insertParamChange(env.DB, {
      agent_id: adj.agent_id,
      changed_by: 'weekly_review',
      old_params: agent.params,
      new_params: newParams,
      reason: adj.reason,
    });
    applied++;
    log.push(`Applied adjustment to ${adj.agent_id}: ${adj.reason}`);
  }

  // Store full review in R2
  const reviewDate = new Date().toISOString().split('T')[0];
  await env.REPORTS.put(
    `reviews/${reviewDate}.json`,
    JSON.stringify({ summaries, llmResponse, adjustments, applied }, null, 2),
    { httpMetadata: { contentType: 'application/json' } }
  );

  log.push(`Applied ${applied} adjustments out of ${adjustments.length} suggestions`);
  return { skipped: false, adjustments: adjustments.length, applied, log };
}

const SYSTEM_PROMPT = `You are a quantitative trading strategy analyst reviewing the weekly performance of 30 automated trading agents. Each agent uses a specific strategy (momentum, mean_reversion, trend_following, volatility_breakout, sector_rotation, value) with a personality (aggressive, conservative, fast, slow, balanced) that determines its parameters.

Your job is to:
1. Assess each agent's performance relative to SPY benchmark
2. Identify agents that are consistently underperforming
3. Suggest specific parameter adjustments to improve performance
4. Be conservative with changes — only suggest adjustments you're confident about

IMPORTANT: You must output your parameter adjustment suggestions in a specific JSON format at the end of your response, inside a <adjustments> tag. Each adjustment must include:
- agent_id: the agent's ID
- confidence: "high", "medium", or "low"
- param_changes: an object with ONLY the parameters to change (not the full param set)
- reason: brief explanation

Example:
<adjustments>
[
  {"agent_id": "momentum-aggressive", "confidence": "high", "param_changes": {"stop_loss_pct": 0.03}, "reason": "Too many stop-outs at 2%, widening to 3% to allow more room"},
  {"agent_id": "meanrev-fast", "confidence": "medium", "param_changes": {"entry_rsi": 28}, "reason": "Entry RSI of 25 triggers too rarely, loosening slightly"}
]
</adjustments>

Only suggest changes where you see clear evidence of a problem. Do not change parameters that are working well. If an agent is performing adequately, do not suggest changes.`;

function buildReviewPrompt(summaries, spyWeeklyPct) {
  const agentSummaries = summaries.map(s => {
    const status = s.is_active ? 'ACTIVE' : `PAUSED (${s.paused_reason})`;
    return `## ${s.id} [${status}]
Strategy: ${s.strategy} | Personality: ${s.personality}
Weekly P&L: $${s.weekly_pnl.toFixed(2)} (${(s.avg_daily_pnl_pct * 100).toFixed(2)}%/day avg)
Alpha vs SPY: ${(s.avg_alpha * 100).toFixed(2)}%/day avg
Win Rate: ${s.win_rate != null ? (s.win_rate * 100).toFixed(0) + '%' : 'N/A'} (${s.trades_this_week} trades)
Sharpe: ${s.sharpe != null ? s.sharpe.toFixed(2) : 'N/A'}
Max Drawdown: ${s.max_drawdown != null ? (s.max_drawdown * 100).toFixed(1) + '%' : 'N/A'}
Cumulative P&L: $${s.cumulative_pnl.toFixed(2)}
Current Parameters: ${JSON.stringify(s.params)}`;
  }).join('\n\n');

  return `# Weekly Trading Agent Review

## Market Context
SPY weekly return: ${(spyWeeklyPct * 100).toFixed(2)}%

## Agent Performance Summaries

${agentSummaries}

Please review each agent's performance and suggest parameter adjustments where warranted. Remember to include your suggestions in the <adjustments> JSON format at the end.`;
}

function parseAdjustments(response) {
  try {
    const match = response.match(/<adjustments>\s*([\s\S]*?)\s*<\/adjustments>/);
    if (!match) return [];
    return JSON.parse(match[1]);
  } catch (e) {
    console.error(`Failed to parse LLM adjustments: ${e.message}`);
    return [];
  }
}

function validateParams(params) {
  // Sanity checks on parameter values
  if (params.stop_loss_pct != null && (params.stop_loss_pct < 0.005 || params.stop_loss_pct > 0.15)) return false;
  if (params.take_profit_pct != null && (params.take_profit_pct < 0.01 || params.take_profit_pct > 0.30)) return false;
  if (params.position_size_pct != null && (params.position_size_pct < 0.03 || params.position_size_pct > 0.25)) return false;
  if (params.max_hold_days != null && (params.max_hold_days < 1 || params.max_hold_days > 30)) return false;
  if (params.entry_rsi != null && (params.entry_rsi < 10 || params.entry_rsi > 50)) return false;
  if (params.exit_rsi != null && (params.exit_rsi < 30 || params.exit_rsi > 80)) return false;
  return true;
}
