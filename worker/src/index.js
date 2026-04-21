// Stocktrade: Multi-agent paper trading system
// Main entry point — handles cron triggers and HTTP requests

import { handleMarketOpen, handleMarketClose } from './orchestrator.js';
import { sendDailyReport } from './report.js';
import { handleWeeklyReview } from './review.js';
import * as db from './db.js';

export default {
  // ── Cron Trigger Handler ──
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    console.log(`Cron fired: ${cron} at ${new Date().toISOString()}`);

    try {
      // Market open crons (9:35 AM ET — both EST and EDT offsets)
      if (cron === '35 13 * * 1-5' || cron === '35 14 * * 1-5') {
        const result = await handleMarketOpen(env);
        if (result.skipped) {
          console.log(`Market open skipped: ${result.reason}`);
        } else {
          console.log(`Market open: ${result.trades} trades placed`);
        }
      }

      // Market close crons (4:05 PM ET — both EST and EDT offsets)
      else if (cron === '5 20 * * 1-5' || cron === '5 21 * * 1-5') {
        const result = await handleMarketClose(env);
        if (result.skipped) {
          console.log(`Market close skipped: ${result.reason}`);
        } else {
          // Send daily report
          const emailResult = await sendDailyReport(
            env, result.date, result.snapshots, result.spyDailyPct
          );
          console.log(`Market close: ${result.closedTrades} trades closed, email: ${emailResult.sent}`);
        }
      }

      // Weekly review cron (Sunday 8 PM ET)
      else if (cron === '0 1 * * 1') {
        const result = await handleWeeklyReview(env);
        if (result.skipped) {
          console.log(`Weekly review skipped: ${result.reason}`);
        } else {
          console.log(`Weekly review: ${result.applied}/${result.adjustments} adjustments applied`);
        }
      }

      else {
        console.log(`Unknown cron: ${cron}`);
      }
    } catch (e) {
      console.error(`Cron ${cron} failed: ${e.message}\n${e.stack}`);
    }
  },

  // ── HTTP Handler (for manual triggers and status checks) ──
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Simple auth check via secret header
    const authHeader = request.headers.get('X-Auth-Key');
    if (authHeader !== env.ADMIN_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      // GET /status — overview of all agents and recent activity
      if (path === '/status' && request.method === 'GET') {
        const agents = await db.getActiveAgents(env.DB);
        const { results: allAgents } = await env.DB.prepare('SELECT * FROM agents').all();
        const today = new Date().toISOString().split('T')[0];
        const snapshots = await db.getAllSnapshotsForDate(env.DB, today);
        const openTrades = await db.getAllOpenTrades(env.DB);

        return Response.json({
          agents: {
            total: allAgents.length,
            active: agents.length,
            paused: allAgents.filter(a => !a.is_active).map(a => ({ id: a.id, reason: a.paused_reason })),
          },
          today: {
            snapshots: snapshots.length,
            total_pnl: snapshots.reduce((s, snap) => s + snap.daily_pnl, 0),
          },
          open_trades: openTrades.length,
        });
      }

      // GET /agents — list all agents with current state
      if (path === '/agents' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM agents').all();
        return Response.json(results.map(a => ({ ...a, params: JSON.parse(a.params) })));
      }

      // GET /agent/:id — detailed agent info
      if (path.startsWith('/agent/') && request.method === 'GET') {
        const agentId = path.slice(7);
        const agent = await db.getAgent(env.DB, agentId);
        if (!agent) return new Response('Agent not found', { status: 404 });
        const openTrades = await db.getOpenTrades(env.DB, agentId);
        const recentTrades = await db.getRecentClosedTrades(env.DB, agentId, 7);
        const snapshots = await db.getSnapshots(env.DB, agentId, 30);
        return Response.json({ agent, openTrades, recentTrades, snapshots });
      }

      // POST /trigger/open — manually trigger market open logic
      if (path === '/trigger/open' && request.method === 'POST') {
        const result = await handleMarketOpen(env);
        return Response.json(result);
      }

      // POST /trigger/close — manually trigger market close logic
      if (path === '/trigger/close' && request.method === 'POST') {
        const result = await handleMarketClose(env);
        if (!result.skipped) {
          await sendDailyReport(env, result.date, result.snapshots, result.spyDailyPct);
        }
        return Response.json(result);
      }

      // POST /trigger/review — manually trigger weekly review
      if (path === '/trigger/review' && request.method === 'POST') {
        const result = await handleWeeklyReview(env);
        return Response.json(result);
      }

      // POST /agent/:id/unpause — reactivate a paused agent
      if (path.startsWith('/agent/') && path.endsWith('/unpause') && request.method === 'POST') {
        const agentId = path.slice(7, -8);
        await env.DB.prepare(
          'UPDATE agents SET is_active = 1, paused_reason = NULL, updated_at = datetime(\'now\') WHERE id = ?'
        ).bind(agentId).run();
        return Response.json({ unpaused: agentId });
      }

      // GET /debug/signals — dry-run entry evaluation, returns all signal results without trading
      if (path === '/debug/signals' && request.method === 'GET') {
        const { debugSignals } = await import('./orchestrator.js');
        const result = await debugSignals(env);
        return Response.json(result);
      }

      return new Response('Not found', { status: 404 });
    } catch (e) {
      return Response.json({ error: e.message, stack: e.stack }, { status: 500 });
    }
  },
};
