/** FAQs the public Help page shows (020-faq.sql). */

export const FAQ_LIMITS = { question: 200, answer: 4000, category: 40 } as const;
export const DEFAULT_CATEGORY = "General";

export type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
  published: boolean;
  updatedAt: string;
};

/** Every field, because saving replaces the whole entry. */
export type FaqInput = {
  id?: string | null;
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
  published: boolean;
};
