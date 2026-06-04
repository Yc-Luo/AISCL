

import { trackingService } from '../../services/tracking/TrackingService'
import { getTabLabel } from '../../lib/stageModel'
import { HelpCircle } from 'lucide-react'

const tabs = [
  { id: 'document' },
  { id: 'inquiry' },
  { id: 'resources' },
  { id: 'wiki' },
  { id: 'ai' },
  { id: 'dashboard' },
]

interface TabNavigationProps {
  activeTab: string
  onTabChange: (tabId: string) => void
  currentStage?: string | null
  recommendedTabs?: string[]
  disabledTabs?: string[]
  hiddenTabs?: string[]
  onOpenGuide?: () => void
}

export default function TabNavigation({
  activeTab,
  onTabChange,
  currentStage,
  recommendedTabs = [],
  disabledTabs = [],
  hiddenTabs = [],
  onOpenGuide,
}: TabNavigationProps) {
  const handleTabChange = (tabId: string) => {
    const isRecommended = recommendedTabs.includes(tabId)
    const isDisabled = disabledTabs.includes(tabId)

    if (isDisabled) {
      trackingService.track({
        module: 'dashboard',
        action: 'main_tab_switch_blocked',
        metadata: {
          from: activeTab,
          to: tabId,
          current_stage: currentStage,
          is_recommended_for_stage: isRecommended,
          block_reason: 'stage_control_mode_hard_constraint',
        }
      })
      return
    }

    trackingService.track({
      module: 'dashboard',
      action: 'main_tab_switch',
      metadata: {
        from: activeTab,
        to: tabId,
        current_stage: currentStage,
        is_recommended_for_stage: isRecommended,
      }
    })
    onTabChange(tabId)
  }

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-3">
        <div aria-hidden="true" />
        <nav className="flex min-w-0 items-center justify-center gap-4 overflow-x-auto px-2" aria-label="Tabs">
          {tabs.filter((tab) => !hiddenTabs.includes(tab.id)).map((tab) => {
            const isRecommended = recommendedTabs.includes(tab.id)
            const isDisabled = disabledTabs.includes(tab.id)
            return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              disabled={isDisabled}
              title={isDisabled ? '当前阶段为硬约束模式，暂不可进入该工具。' : undefined}
              className={`
                py-2 px-1.5 border-b-2 font-medium text-sm transition-all relative disabled:cursor-not-allowed whitespace-nowrap
                ${activeTab === tab.id
                  ? 'text-indigo-600'
                  : isDisabled
                    ? 'border-transparent text-gray-300'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              <span className="inline-flex items-center gap-1">
                {getTabLabel(tab.id)}
                {isRecommended && (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                    建议
                  </span>
                )}
              </span>
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
              )}
            </button>
            )}
          )}
        </nav>
        <div className="flex justify-end">
          {onOpenGuide ? (
            <button
              type="button"
              onClick={onOpenGuide}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-indigo-500 transition hover:bg-indigo-50 hover:text-indigo-700"
              title="打开使用指南"
              aria-label="打开使用指南"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
