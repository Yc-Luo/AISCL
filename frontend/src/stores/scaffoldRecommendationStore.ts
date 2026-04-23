import { create } from 'zustand'

export type RecommendationTarget = 'assistant' | 'tutor'

export interface ScaffoldRecommendation {
    id: string
    target: RecommendationTarget
    source: RecommendationTarget
    ruleId: string
    ruleType: string
    ruleName: string
    recommendedRole: string
    prompt: string
    createdAt: string
}

interface ScaffoldRecommendationState {
    queue: ScaffoldRecommendation[]
    enqueueRecommendation: (item: ScaffoldRecommendation) => void
    consumeRecommendation: (target: RecommendationTarget) => ScaffoldRecommendation | undefined
}

export const useScaffoldRecommendationStore = create<ScaffoldRecommendationState>((set, get) => ({
    queue: [],
    enqueueRecommendation: (item) => set((state) => ({ queue: [...state.queue, item] })),
    consumeRecommendation: (target) => {
        const state = get()
        const next = state.queue.find((item) => item.target === target)
        if (!next) return undefined
        set({
            queue: state.queue.filter((item) => item.id !== next.id)
        })
        return next
    }
}))
