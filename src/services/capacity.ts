// src/services/capacity.ts: Operational snapshot + advice for the admin dashboard
import type { Bindings } from '../types';
import { getCapacityCounts, purgeOldAccessLogs } from '../db/queries';
import { FEED_MAX_AGE_MS, readPublicFeedSnapshot } from './feedSnapshot';

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
      body: '公開一覧の読み取りを減らすため FEED_KV を接続してください。検索・範囲指定・自分の投稿は D1 を使います。',
    });
  } else if (r.snapshotAgeSeconds === null) {
    advice.push({
      level: 'watch',
      title: 'KV スナップショットがまだ無い',
      body: '毎分の Cron と書き込み後に更新を要求します。Queue の滞留を確認し、管理画面から更新を要求できます。',
    });
  } else if (r.snapshotAgeSeconds > FEED_MAX_AGE_MS / 1000) {
    advice.push({
      level: 'act',
      title: `スナップショットが ${Math.round(r.snapshotAgeSeconds / 60)} 分古い`,
      body: '書き込み後の更新が止まっている可能性があります。手動更新を試し、Queue / Worker ログを確認してください。',
    });
  }

  if (r.posts < 5000) {
    advice.push({
      level: 'ok',
      title: `投稿 ${r.posts.toLocaleString()} 件 — 処理能力は別途測定`,
      body: '件数だけでは同時アクセスの限界を判断できません。集中アクセス時の遅延・エラー率・Queue の滞留を確認してください。',
    });
  } else if (r.posts < 10000) {
    advice.push({
      level: 'watch',
      title: `投稿 ${r.posts.toLocaleString()} 件 — 絞り込みの負荷を確認`,
      body: 'タグ・文字検索・近傍検索を測定してください。行読みや遅延が増える場合は索引や検索用テーブルを検討します。',
    });
  } else if (r.posts < 20000) {
    advice.push({
      level: 'watch',
      title: `投稿 ${r.posts.toLocaleString()} 件 — 検索と保管の実測を確認`,
      body: 'この件数は D1 の上限ではありません。検索・深いページ・バックアップの所要時間と容量を測定してください。',
    });
  } else {
    advice.push({
      level: 'watch',
      title: `投稿 ${r.posts.toLocaleString()} 件 — バックアップ上限も確認`,
      body: '全表合計200ページのバックアップ上限に近づく可能性があります。外部エクスポートを確保し、遅延・容量の測定結果から構成を判断してください。',
    });
  }

  if (r.writeEvents24h > 20000) {
    advice.push({
      level: 'act',
      title: `直近24時間の書き込みイベント ${r.writeEvents24h.toLocaleString()}`,
      body: '24時間の総量だけでは過負荷を判断できません。ピーク時の遅延、D1 overload、Queue の滞留時間を確認してください。',
    });
  } else if (r.writeEvents24h > 5000) {
    advice.push({
      level: 'watch',
      title: `直近24時間の書き込みイベント ${r.writeEvents24h.toLocaleString()}`,
      body: 'ピークの集中度は未測定です。Queue の滞留時間と D1 overload をダッシュボードで確認してください。',
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
      title: '現状の件数から移行の要否は判断しません',
      body: '負荷試験と実際の使用量で判断します。Workers・D1・KV・Queue・R2 の利用枠と費用も確認してください。',
    });
  }

  const order = { act: 0, watch: 1, ok: 2 };
  advice.sort((a, b) => order[a.level] - order[b.level]);
  return advice;
}
