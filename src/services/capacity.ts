// src/services/capacity.ts: Operational snapshot + advice for the admin dashboard
import type { Bindings } from '../types';
import { getCapacityCounts, purgeOldAccessLogs } from '../db/queries';
import { readPublicFeedSnapshot } from './feedSnapshot';

export interface CapacityAdvice {
  level: 'ok' | 'watch' | 'act';
  title: string;
  body: string;
}

export interface CapacityReport {
  generatedAt: string;
  kvBound: boolean;
  snapshotAgeSeconds: number | null;
  snapshotTotal: number | null;
  posts: number;
  postsUpdated24h: number;
  writeEvents24h: number;
  accessLogs: number;
  deviceSessions: number;
  advice: CapacityAdvice[];
}

export async function buildCapacityReport(
  env: Bindings
): Promise<CapacityReport> {
  const counts = await getCapacityCounts(env.DB);
  const snapshot = await readPublicFeedSnapshot(env);
  let snapshotAgeSeconds: number | null = null;
  if (snapshot?.generatedAt) {
    const age = Date.now() - Date.parse(snapshot.generatedAt);
    if (!Number.isNaN(age))
      snapshotAgeSeconds = Math.max(0, Math.round(age / 1000));
  }

  const report: CapacityReport = {
    generatedAt: new Date().toISOString(),
    kvBound: Boolean(env.FEED_KV),
    snapshotAgeSeconds,
    snapshotTotal: snapshot?.total ?? null,
    posts: counts.posts,
    postsUpdated24h: counts.postsUpdated24h,
    writeEvents24h: counts.writeEvents24h,
    accessLogs: counts.accessLogs,
    deviceSessions: counts.deviceSessions,
    advice: [],
  };
  report.advice = buildAdvice(report);
  return report;
}

export async function runCapacityMaintenance(env: Bindings): Promise<void> {
  await purgeOldAccessLogs(env.DB, 7);
}

function buildAdvice(r: CapacityReport): CapacityAdvice[] {
  const advice: CapacityAdvice[] = [];

  if (!r.kvBound) {
    advice.push({
      level: 'act',
      title: '公開フィード用 KV が未接続',
      body: 'FEED_KV を wrangler.toml に載せると、閲覧が D1 を踏まなくなります。Workers Paid の無料枠内です。',
    });
  } else if (r.snapshotAgeSeconds === null) {
    advice.push({
      level: 'watch',
      title: 'KV スナップショットがまだ無い',
      body: '投稿か状況更新が1件入ると自動で作られます。管理画面から「スナップショットを更新」もできます。',
    });
  } else if (r.snapshotAgeSeconds > 300) {
    advice.push({
      level: 'act',
      title: `スナップショットが ${Math.round(r.snapshotAgeSeconds / 60)} 分古い`,
      body: '書き込み後の更新が止まっている可能性があります。手動更新を試し、Queue / Worker ログを確認してください。',
    });
  }

  if (r.posts < 5000) {
    advice.push({
      level: 'ok',
      title: `投稿 ${r.posts.toLocaleString()} 件 — 局所的な災害の生活情報板として余裕`,
      body: '数千件規模までは現行の D1 1本で足ります。',
    });
  } else if (r.posts < 10000) {
    advice.push({
      level: 'watch',
      title: `投稿 ${r.posts.toLocaleString()} 件 — タグ絞り込みが重くなり始める帯`,
      body: '語彙フィルターが遅いと感じたら post_tags 交差テーブルを足してください。費用は増えません。',
    });
  } else if (r.posts < 20000) {
    advice.push({
      level: 'act',
      title: `投稿 ${r.posts.toLocaleString()} 件 — 単一 D1 の上限が見えてきた`,
      body: '公開一覧は KV 任せのまま、書き込み D1 と読み取りを分けるか、自治体ごとに D1 を分割する段階です。',
    });
  } else {
    advice.push({
      level: 'act',
      title: `投稿 ${r.posts.toLocaleString()} 件 — バックエンド分割を検討`,
      body: 'tossa.app は製品サイトに残し、実データは自治体ごとの D1、または Hyperdrive 経由の PostgreSQL へ。Hyperdrive は月額課金が発生します。',
    });
  }

  if (r.writeEvents24h > 20000) {
    advice.push({
      level: 'act',
      title: `直近24時間の書き込みイベント ${r.writeEvents24h.toLocaleString()}`,
      body: 'D1 が単スレッドで追いつかない兆候です。状況更新の間引きと、書き込み Queue の滞留を見てください。',
    });
  } else if (r.writeEvents24h > 5000) {
    advice.push({
      level: 'watch',
      title: `直近24時間の書き込みイベント ${r.writeEvents24h.toLocaleString()}`,
      body: 'ピークとしては高いです。Queue lag と D1 overload が出ていないかダッシュボードを見てください。',
    });
  }

  if (r.accessLogs > 200000) {
    advice.push({
      level: 'watch',
      title: `アクセスログ ${r.accessLogs.toLocaleString()} 行`,
      body: '日次 cron が 7 日より古い行を消します。増えたままなら cron が落ちていないか確認してください。',
    });
  }

  if (advice.every((a) => a.level === 'ok') && r.kvBound) {
    advice.push({
      level: 'ok',
      title: '追加の課金なしで、いまの構成を維持してよい',
      body: 'KV・Queue・R2 は Workers Paid の枠内。PostgreSQL / Hyperdrive はまだ不要です。',
    });
  }

  const order = { act: 0, watch: 1, ok: 2 };
  advice.sort((a, b) => order[a.level] - order[b.level]);
  return advice;
}
