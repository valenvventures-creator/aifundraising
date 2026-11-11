/**
 * AI content generation. Produces DRAFTS ONLY — nothing here sends, posts or
 * modifies records. When no Anthropic credentials are configured, a
 * deterministic template writer is used so the product still works.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client: Anthropic | null = null;
export function claude(): Anthropic | null {
  if (!config.aiEnabled) return null;
  client ??= new Anthropic();
  return client;
}

export const BASE_SYSTEM = `You are the writing and analysis assistant inside A.I. Fundraising, a nonprofit operating system.
You produce drafts and explanations for nonprofit staff. You never claim to have sent, posted, saved or changed anything —
a person reviews your output and decides what to do with it. Be accurate: only state facts that appear in the provided data;
when you estimate or recommend, say so. Keep donor information confidential and respectful.`;

/** Single-shot text generation. Returns null if AI is not configured. */
export async function generateText(opts: { system?: string; prompt: string; maxTokens?: number; effort?: 'low' | 'medium' | 'high' }): Promise<string | null> {
  const c = claude();
  if (!c) return null;
  const params: any = {
    model: config.anthropicModel,
    max_tokens: opts.maxTokens ?? 16000,
    system: `${BASE_SYSTEM}\n\n${opts.system ?? ''}`.trim(),
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort ?? 'medium' },
    messages: [{ role: 'user', content: opts.prompt }],
  };
  // Server-side refusal fallback (opt-in) — re-runs a declined request on a fallback model inside the same call.
  if (config.anthropicModel === 'claude-opus-5-5') { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
  const msg: any = params.betas ? await (c.beta.messages as any).create(params) : await c.messages.create(params);
  if (msg.stop_reason === 'refusal') return 'The assistant declined to draft this request. Please rephrase or write it manually.';
  return msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

export interface VoiceProfile {
  tone?: string | null; leader_voice?: string | null; faith_language?: string | null; scripture_usage?: string | null;
  urgency?: number | null; formality?: number | null; donor_centeredness?: number | null; themes?: string | null;
  words_to_use?: string | null; words_to_avoid?: string | null; faith_enabled?: boolean;
}

export function voiceInstructions(v: VoiceProfile | null) {
  if (!v) return '';
  const lines = [
    v.tone && `Organization tone: ${v.tone}`,
    v.leader_voice && `Leader voice: ${v.leader_voice}`,
    v.faith_enabled ? (v.faith_language && `Faith language: ${v.faith_language}`) : 'Do not use faith or religious language.',
    v.faith_enabled && v.scripture_usage && `Scripture usage: ${v.scripture_usage}`,
    v.urgency && `Urgency (1-5): ${v.urgency}`, v.formality && `Formality (1-5): ${v.formality}`,
    v.donor_centeredness && `Donor-centeredness (1-5): ${v.donor_centeredness} — make the donor the hero`,
    v.themes && `Themes: ${v.themes}`, v.words_to_use && `Prefer words: ${v.words_to_use}`, v.words_to_avoid && `Avoid words: ${v.words_to_avoid}`,
  ].filter(Boolean);
  return lines.length ? `Voice profile:\n- ${lines.join('\n- ')}` : '';
}

export const CONTENT_TYPES: Record<string, string> = {
  thank_you: 'Thank-you letter', donor_email: 'Donor email', appeal: 'Fundraising appeal', update: 'Impact update',
  newsletter: 'Newsletter copy', call_script: 'Call script', proposal: 'Major donor proposal', campaign_message: 'Campaign message',
  social: 'Social media copy', event_invitation: 'Event invitation', follow_up: 'Follow-up note', grant_narrative: 'Grant narrative',
  impact_story: 'Impact story', subject_lines: 'Email subject lines',
};

/** Deterministic fallback drafts — used when AI is not configured. */
export function templateDraft(kind: string, ctx: { orgName: string; donorFirst?: string; donorName?: string; amount?: string; lastGift?: string;
  fund?: string; campaign?: string; context?: string; senderName: string; ask?: string; faith?: boolean; eventName?: string }) {
  const hi = ctx.donorFirst ? `Dear ${ctx.donorFirst},` : 'Dear friend,';
  const sign = `\n\nWith gratitude,\n${ctx.senderName}\n${ctx.orgName}`;
  const bless = ctx.faith ? ' We thank God for you.' : '';
  const extra = ctx.context ? `\n\n${ctx.context}` : '';
  switch (kind) {
    case 'thank_you':
      return `${hi}\n\nThank you for your generous gift${ctx.amount ? ` of ${ctx.amount}` : ''}${ctx.fund ? ` to ${ctx.fund}` : ''}. Because of you, ${ctx.orgName} can keep showing up for the people we serve.${bless}${extra}\n\nYou are a vital part of this work, and we are so grateful.${sign}`;
    case 'call_script':
      return `CALL SCRIPT — ${ctx.donorName ?? 'Donor'}\n\n1. Greeting: “Hi ${ctx.donorFirst ?? 'there'}, this is ${ctx.senderName} from ${ctx.orgName}. Do you have a few minutes?”\n2. Gratitude: Thank them${ctx.lastGift ? ` for their gift on ${ctx.lastGift}` : ' for their support'}.\n3. Listen: “What drew you to support ${ctx.orgName}?” — note what they say.\n4. Share impact: one specific story or number from this quarter.${ctx.context ? `\n   Context: ${ctx.context}` : ''}\n5. Ask${ctx.ask ? `: “Would you consider a gift of ${ctx.ask}${ctx.campaign ? ` toward ${ctx.campaign}` : ''}?”` : ': invite their next step.'} Then pause.\n6. Close: confirm next step and follow-up date. Log the call in A.I. Fundraising.`;
    case 'proposal':
      return `PROPOSAL FOR ${(ctx.donorName ?? 'Partner').toUpperCase()}\n\nThe opportunity\n${ctx.context || `${ctx.orgName} is expanding its reach this year.`}\n\nYour partnership\nWe invite you to consider an investment of ${ctx.ask ?? '[amount]'}${ctx.fund ? ` designated to ${ctx.fund}` : ''}.\n\nWhat it makes possible\n• [Outcome 1]\n• [Outcome 2]\n• [Outcome 3]\n\nHow we will report back\nQuarterly impact updates and an annual summary.${sign}`;
    case 'appeal': case 'campaign_message':
      return `${hi}\n\n${ctx.context || `Right now, ${ctx.orgName} has an opportunity to do more — and we need your help.`}\n\n${ctx.ask ? `Would you give ${ctx.ask} today` : 'Will you give today'}${ctx.campaign ? ` to ${ctx.campaign}` : ''}? Every gift makes a difference.${bless}${sign}`;
    case 'event_invitation':
      return `${hi}\n\nYou're invited${ctx.eventName ? ` to ${ctx.eventName}` : ''}! We'd love to have you with us to celebrate what your support has made possible.${extra}\n\nPlease RSVP using the registration link.${sign}`;
    case 'follow_up':
      return `${hi}\n\nIt was good to connect recently. Following up on our conversation${ctx.context ? `: ${ctx.context}` : ''}.\n\nPlease let me know if you have any questions.${sign}`;
    case 'subject_lines':
      return [`${ctx.donorFirst ? `${ctx.donorFirst}, ` : ''}you made this possible`, `A quick update from ${ctx.orgName}`, 'Your gift is already at work', `Will you stand with us${ctx.campaign ? ` for ${ctx.campaign}` : ''}?`, 'One story we had to share'].join('\n');
    case 'social':
      return `Because of generous friends like you, ${ctx.orgName} ${ctx.context || 'is making a difference every day'}. ${ctx.campaign ? `Join us in ${ctx.campaign}! ` : ''}#nonprofit #givingback`;
    default:
      return `${hi}\n\n${ctx.context || `Here is an update from ${ctx.orgName}.`}\n\nThank you for being part of this work.${sign}`;
  }
}
