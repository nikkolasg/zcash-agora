// What the page says about each poll beside its title (the title is the
// ledger's). Polls 4 to 8 repeat, word for word, the questions of the Zcash
// coinholder and community-panel poll of 16 to 30 November 2026 (NU7.1).
export interface Question { short: string; summary: string; link?: string; test?: boolean }

const F = 'https://forum.zcashcommunity.com/t/';
export const QUESTIONS: Record<number, Question> = {
  4: { short: 'Wind down ZCG', link: `${F}58515`, summary: 'This proposal would wind down ZCG and end new grants. Grants already awarded would continue, with payments made as agreed milestones are met. After covering existing grants and wind-down costs, remaining funds would go to the Future Dev and Legal Defense Fund Lockbox. If ZCG\'s 8% funding stream is still active when the upgrade takes effect, it would go to that lockbox until the November 2028 halving.' },
  5: { short: 'Dev and Legal Defense Fund', link: `${F}58611`, summary: 'This proposal would redirect ZCG\'s 8% funding stream to a new Future Dev and Legal Defense Fund lockbox requiring community approval for disbursements, require ZCG to contribute 50,000 ZEC to the NSM, and preserve ZCG and its grant program with its remaining treasury.' },
  6: { short: 'Zcash Adoption Pool', link: `${F}58656`, summary: 'This proposal would retain ZCG\'s existing treasury and continue its 8% funding stream through November 2028. It would rename the grant program and its pool of funds to Zcash Adoption Pool, consistent with using those funds to increase Zcash and ZEC adoption as broadly as possible. It would also leave open the possibility of using funds from the existing treasury for development and legal defense.' },
  7: { short: 'Status quo', summary: 'This is the status quo option. ZCG would continue receiving its 8% funding stream through the November 2028 halving, and its treasury and operations would remain unchanged.' },
  8: { short: '20-second blocks', link: `${F}59035`, summary: 'A shorter target block time, from 25 seconds to 20 seconds, as part of the NU7.1 network upgrade.' },
  3: { short: 'Test: ZSAs', test: true, summary: '' }
};

/** The polls this browser has cast a ballot in (a mark for the question list, nothing else). */
const KEY = 'agora-voted';
export function voted(): number[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[]; } catch { return []; }
}
export function markVoted(poll: number): void {
  try { const v = new Set(voted()); if (v.has(poll)) return; v.add(poll); localStorage.setItem(KEY, JSON.stringify([...v])); } catch { /* a private window: no mark */ }
}
