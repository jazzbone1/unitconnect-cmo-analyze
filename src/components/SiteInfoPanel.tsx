import type { SettlementConfig } from '../lib/settlement'
import type { SavedSite } from '../lib/sites'
import SiteConfigForm, { EMPTY_SITE, type SiteInfo } from './SiteConfigForm'

export { EMPTY_SITE }
export type { SiteInfo }

interface SiteInfoPanelProps {
  site: SiteInfo
  setSite: (s: SiteInfo) => void
  config: SettlementConfig
  setConfig: (c: SettlementConfig) => void
  onReset: () => void
  // 현장 목록 관리
  sites: SavedSite[]
  selectedId: string | null
  onSave: () => void
  onLoad: (s: SavedSite) => void
  onDelete: (id: string) => void
  onNew: () => void
}

/**
 * 단지 정보 패널 = 저장된 현장 목록 + 저장/새 현장 버튼 + 편집 폼.
 */
export default function SiteInfoPanel({
  site,
  setSite,
  config,
  setConfig,
  onReset,
  sites,
  selectedId,
  onSave,
  onLoad,
  onDelete,
  onNew,
}: SiteInfoPanelProps) {
  const canSave = site.name.trim() !== ''

  return (
    <section className="card">
      <div className="card__header">
        <h2>단지 정보 · 충전기 설정</h2>
        <span className="badge">이용량·사업성 분석에 자동 적용</span>
      </div>

      {sites.length > 0 && (
        <div className="subsection">
          <h3 className="subsection__title">
            저장된 현장 <span className="count-tag">{sites.length}곳</span>
          </h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>단지명</th>
                  <th>주소</th>
                  <th>세대수</th>
                  <th>충전기</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const cnt = s.chargers.reduce((a, c) => a + c.count, 0)
                  return (
                    <tr
                      key={s.id}
                      className={s.id === selectedId ? 'row--selected' : ''}
                    >
                      <td className="col-name">{s.name}</td>
                      <td className="col-name">{s.address || '—'}</td>
                      <td>{s.households ? s.households.toLocaleString() : '—'}</td>
                      <td>{cnt.toLocaleString()}기</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onLoad(s)}
                        >
                          불러오기
                        </button>
                        <button
                          type="button"
                          className="remove-button"
                          aria-label={`${s.name} 삭제`}
                          onClick={() => onDelete(s.id)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="site-edit-head">
        <h3 className="subsection__title">
          {selectedId ? '현장 정보 수정' : '새 현장 입력'}
        </h3>
        <div className="site-edit-actions">
          <button type="button" className="link-button" onClick={onNew}>
            + 새 현장
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canSave}
            onClick={onSave}
            title={canSave ? '' : '단지명을 입력하세요'}
          >
            {selectedId ? '현장 저장(수정)' : '현장 저장'}
          </button>
        </div>
      </div>

      <SiteConfigForm
        site={site}
        setSite={setSite}
        config={config}
        setConfig={setConfig}
        onReset={onReset}
      />
    </section>
  )
}
