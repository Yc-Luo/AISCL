export type InquiryCardType = 'text' | 'image' | 'link' | 'ai_response';

export interface InquiryCard {
    id: string;
    type: InquiryCardType;
    content: string;
    authorId: string;
    authorName: string;
    createdAt: number;
    sourceUrl?: string;
    sourceTitle?: string;
    imageUrl?: string;
    tags?: string[];
    position?: { x: number; y: number };
}

export type InquiryNodeType = 'claim' | 'evidence' | 'counter-argument' | 'rebuttal';

export interface InquiryNodeData {
    label: string;
    sourceRef?: string; // Reference to InquiryCard id
    sourceUrl?: string;
    sourceTitle?: string;
    imageUrl?: string;
    content?: string;
    authorId?: string;
}

export type InquiryEdgeType = 'supports' | 'refutes' | 'contains';

export interface InquiryEdgeData {
    label: InquiryEdgeType;
}
