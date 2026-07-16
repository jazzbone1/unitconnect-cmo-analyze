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
  selectedId,
  onSave,
  onNew,
}: SiteInfoPanelProps) {
  const canSave = site.name.trim() !== ''

  return (
    <section className="card">
      <div className="card__header">
        <h2>단지 정보 · 충전기 설정</h2>
        <span className="badge">이용량·사업성 분석에 자동 적용</span>
      </div>

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
