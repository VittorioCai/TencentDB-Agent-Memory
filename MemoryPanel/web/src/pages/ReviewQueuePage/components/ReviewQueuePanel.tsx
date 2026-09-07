/**
 * ReviewQueuePanel — the admission gate's human queue.
 *
 * What it shows is what Core wrote onto each asset (metadata_json.gate):
 * the decision the three rules reached, the review priority the author
 * signal set, the context-based author assessment when one is on file, and
 * the reviewer's own verdict once given. Nothing here is computed in the
 * browser; every number comes from `asset/gate/get`.
 *
 * Three views, one per pool: candidates (pending — the queue proper, sorted
 * by priority), approved, failed. A reviewer or admin admits or rejects a
 * candidate by hand (`asset/gate/review`; Core refuses an author reviewing
 * their own asset) or asks Core to re-evaluate from the outcomes on file
 * (`asset/gate/evaluate`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, Card, Button, Text, Justify, H3, Modal, Alert, Tag, Input } from 'tea-component';
import { assetsApi, gateApi } from '@/lib/teamApi';
import type { Asset, AssetStatus, AssetGateView } from '@/lib/api/types';
import { useTeams } from '@/services';
import { useCurrentRole } from '@/services/useCurrentRole';
import { useAuthStore } from '@/stores/auth';
import { tea } from '@/lib/tea-bridge';

const { autotip } = Table.addons;

type Pool = 'candidate' | 'approved' | 'failed';
const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

interface Row {
  asset: Asset;
  gate: AssetGateView | null;
  error?: string;
}

function priorityTheme(p: string | null | undefined): 'error' | 'warning' | 'success' | 'default' {
  if (p === 'high') return 'error';
  if (p === 'normal') return 'warning';
  if (p === 'low') return 'success';
  return 'default';
}

export default function ReviewQueuePanel() {
  const { t } = useTranslation();
  const role = useCurrentRole();
  const { auth } = useAuthStore();
  const { activeTeamId } = useTeams();
  const [pool, setPool] = useState<Pool>('candidate');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ row: Row; decision: 'admit' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const canReview = role === 'admin' || role === 'reviewer';

  const refresh = useCallback(async () => {
    if (!activeTeamId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const assets = await assetsApi.list(activeTeamId, { status: pool as AssetStatus });
      const withGate = await Promise.all(
        assets.map(async (asset): Promise<Row> => {
          try { return { asset, gate: await gateApi.get(asset.asset_id) }; }
          catch (e) { return { asset, gate: null, error: e instanceof Error ? e.message : String(e) }; }
        }),
      );
      withGate.sort((x, y) => {
        const px = PRIORITY_RANK[x.gate?.gate?.review_priority ?? ''] ?? 3;
        const py = PRIORITY_RANK[y.gate?.gate?.review_priority ?? ''] ?? 3;
        return px - py || (y.asset.updated_at ?? '').localeCompare(x.asset.updated_at ?? '');
      });
      setRows(withGate);
    } catch (e) {
      tea.notify.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeamId, pool]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function evaluate(row: Row) {
    setBusy(row.asset.asset_id);
    try { await gateApi.evaluate(row.asset.asset_id, true); await refresh(); }
    catch (e) { tea.notify.error(e); }
    finally { setBusy(null); }
  }

  async function submitReview() {
    if (!reviewing) return;
    setBusy(reviewing.row.asset.asset_id);
    try {
      await gateApi.review(reviewing.row.asset.asset_id, reviewing.decision, note.trim() || undefined);
      setReviewing(null); setNote('');
      await refresh();
    } catch (e) { tea.notify.error(e); }
    finally { setBusy(null); }
  }

  const counts = useMemo(() => ({ high: rows.filter((r) => r.gate?.gate?.review_priority === 'high').length }), [rows]);

  return (
    <div className="_memory-review-queue">
      <Justify
        left={
          <div>
            <H3>{t('review.title')}</H3>
            <Text theme="text" parent="div" style={{ marginTop: 4 }}>{t('review.desc')}</Text>
          </div>
        }
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {(['candidate', 'approved', 'failed'] as Pool[]).map((p) => (
              <Button key={p} type={pool === p ? 'primary' : 'weak'} onClick={() => setPool(p)}>{t(`review.pool.${p}`)}</Button>
            ))}
            <Button onClick={() => void refresh()}>{t('review.refresh')}</Button>
          </div>
        }
      />
      {!canReview && (
        <Alert type="info" style={{ marginTop: 12 }}>{t('review.readOnly')}</Alert>
      )}
      {pool === 'candidate' && counts.high > 0 && (
        <Alert type="warning" style={{ marginTop: 12 }}>{t('review.highCount', { n: counts.high })}</Alert>
      )}
      <Card style={{ marginTop: 12 }}>
        <Table
          verticalTop
          records={rows}
          recordKey={(r: Row) => r.asset.asset_id}
          addons={[autotip({ isLoading: loading, emptyText: t('review.empty') })]}
          columns={[
            {
              key: 'name', header: t('review.table.asset'),
              render: (r: Row) => (
                <div>
                  <Text parent="div" style={{ fontWeight: 600 }}>{r.asset.name}</Text>
                  <Text parent="div" theme="label" style={{ fontSize: 12 }}>{r.asset.asset_type} · <code>{r.asset.asset_id}</code></Text>
                </div>
              ),
            },
            {
              key: 'owner', header: t('review.table.author'), width: 200,
              render: (r: Row) => (
                <div>
                  <Text parent="div" style={{ fontSize: 12 }}><code>{r.asset.owner_user_id}</code>{r.asset.owner_user_id === auth?.user_id ? ` (${t('review.you')})` : ''}</Text>
                  {r.gate?.gate?.signals?.author && (
                    <Text parent="div" theme="label" style={{ fontSize: 12 }}>
                      {t('review.authorRecord', { v: r.gate.gate.signals.author.validated, c: r.gate.gate.signals.author.corrected })}
                    </Text>
                  )}
                </div>
              ),
            },
            {
              key: 'priority', header: t('review.table.priority'), width: 120,
              render: (r: Row) => {
                const p = r.gate?.gate?.review_priority;
                return p ? <Tag theme={priorityTheme(p)}>{t(`review.priority.${p}`)}</Tag> : <Text theme="label">—</Text>;
              },
            },
            {
              key: 'decision', header: t('review.table.decision'), width: 220,
              render: (r: Row) => {
                const g = r.gate?.gate;
                if (r.error) return <Text theme="danger" style={{ fontSize: 12 }}>{r.error}</Text>;
                if (!g) return <Text theme="label">{t('review.noDecision')}</Text>;
                return (
                  <div>
                    <Text parent="div">{t(`review.decision.${g.decision}`)}{g.confidence != null ? ` · ${t('review.evidenceConfidence', { c: g.confidence, n: g.confidence_n ?? '?' })}` : ''}</Text>
                    <Text parent="div" theme="label" style={{ fontSize: 12 }}>
                      {t('review.outcomes', { v: g.signals.online.validated, c: g.signals.online.corrected })} · {g.rules_version}
                    </Text>
                    {(g.signals.online.untrusted_ignored ?? 0) > 0 && (
                      <Text parent="div" theme="label" style={{ fontSize: 12 }}>{t('review.untrustedIgnored', { n: g.signals.online.untrusted_ignored })}</Text>
                    )}
                    {r.gate?.review_requested && <Tag theme="primary">{t('review.submittedByOwner')}</Tag>}
                    {r.gate?.review && (
                      <Text parent="div" theme="label" style={{ fontSize: 12 }}>
                        {t('review.reviewedBy', { d: t(`review.decision.${r.gate.review.decision}`), by: r.gate.review.by })}
                      </Text>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'assessment', header: t('review.table.assessment'), width: 240,
              render: (r: Row) => {
                const a = r.gate?.gate?.signals?.author?.assessment;
                if (!a) return <Text theme="label" style={{ fontSize: 12 }}>{t('review.noAssessment')}</Text>;
                const claim = a.asset_claim_check?.verdict;
                return (
                  <div>
                    <Text parent="div" style={{ fontSize: 12 }}>{t('review.competence', { c: t(`review.competenceWord.${a.competence}`) })}</Text>
                    {claim && (
                      <Tag theme={claim === 'contradicts' ? 'error' : claim === 'supports' ? 'success' : 'default'}>
                        {t(`review.claim.${claim}`)}
                      </Tag>
                    )}
                    <Text parent="div" theme="label" style={{ fontSize: 12 }}>{t('review.citations', { n: a.citations })} · {a.domain}</Text>
                  </div>
                );
              },
            },
            {
              key: 'actions', header: t('review.table.actions'), width: 260,
              render: (r: Row) => (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button type="link" onClick={() => setExpanded(expanded === r.asset.asset_id ? null : r.asset.asset_id)}>
                    {expanded === r.asset.asset_id ? t('review.hideReasons') : t('review.showReasons')}
                  </Button>
                  {canReview && (
                    <>
                      <Button type="link" disabled={busy === r.asset.asset_id} onClick={() => void evaluate(r)}>{t('review.reevaluate')}</Button>
                      {pool !== 'approved' && (
                        <Button type="link" disabled={busy === r.asset.asset_id || r.asset.owner_user_id === auth?.user_id} onClick={() => { setReviewing({ row: r, decision: 'admit' }); setNote(''); }}>{t('review.admit')}</Button>
                      )}
                      {pool !== 'failed' && (
                        <Button type="link" disabled={busy === r.asset.asset_id || r.asset.owner_user_id === auth?.user_id} onClick={() => { setReviewing({ row: r, decision: 'reject' }); setNote(''); }}>{t('review.reject')}</Button>
                      )}
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
        {expanded && rows.find((r) => r.asset.asset_id === expanded)?.gate?.gate && (
          <div style={{ padding: 12, borderTop: '1px solid #eee' }}>
            <Text parent="div" style={{ fontWeight: 600, marginBottom: 6 }}>{t('review.reasonsTitle')}</Text>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {rows.find((r) => r.asset.asset_id === expanded)!.gate!.gate!.reasons.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
            <Text parent="div" theme="label" style={{ fontSize: 12, marginTop: 6 }}>
              {t('review.evidenceRefs', { n: rows.find((r) => r.asset.asset_id === expanded)!.gate!.gate!.evidence_refs.length })}
              {rows.find((r) => r.asset.asset_id === expanded)!.gate!.gate!.evidence_as_of ? ` · as_of ${rows.find((r) => r.asset.asset_id === expanded)!.gate!.gate!.evidence_as_of}` : ''}
            </Text>
          </div>
        )}
      </Card>

      <Modal visible={!!reviewing} caption={reviewing ? t(reviewing.decision === 'admit' ? 'review.confirmAdmit' : 'review.confirmReject', { name: reviewing.row.asset.name }) : ''} onClose={() => setReviewing(null)}>
        <Modal.Body>
          <Text parent="div" style={{ marginBottom: 8 }}>{t('review.noteHint')}</Text>
          <Input value={note} onChange={(v: string) => setNote(v)} placeholder={t('review.notePlaceholder')} style={{ width: '100%' }} />
        </Modal.Body>
        <Modal.Footer>
          <Button type={reviewing?.decision === 'admit' ? 'primary' : 'error'} loading={!!busy} onClick={() => void submitReview()}>
            {reviewing ? t(reviewing.decision === 'admit' ? 'review.admit' : 'review.reject') : ''}
          </Button>
          <Button onClick={() => setReviewing(null)}>{t('review.cancel')}</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
