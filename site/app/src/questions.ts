// The election the page shows: several polls of the ledger asked as one
// ballot. Polls 4 to 8 repeat, word for word, the questions of the Zcash
// coinholder and community-panel poll of 16 to 30 November 2026 (NU7.1).
// The titles are the ledger's (ledger/polls/<id>.json); the summaries are the
// organisers'.
export interface Question { title: string; summary: string; link?: string }

const F = 'https://forum.zcashcommunity.com/t/';
export const ELECTION = {
  title: 'The NU7.1 poll, one person, one vote',
  instructions: 'Please consider each proposal independently. You may support more than one proposal, including proposals that conflict with each other, if you would find any of those outcomes acceptable.',
  circuit: 'choice4_tlock_linked_d20'
};
export const QUESTIONS: Record<number, Question> = {
  4: { title: 'Do you support the Wind Down Zcash Community Grants proposal?', link: `${F}58515`, summary: 'This proposal would wind down ZCG and end new grants. Grants already awarded would continue, with payments made as agreed milestones are met. After covering existing grants and wind-down costs, remaining funds would go to the Future Dev and Legal Defense Fund Lockbox. If ZCG\'s 8% funding stream is still active when the upgrade takes effect, it would go to that lockbox until the November 2028 halving.' },
  5: { title: 'Do you support the Future Dev and Legal Defense Fund proposal?', link: `${F}58611`, summary: 'This proposal would redirect ZCG\'s 8% funding stream to a new Future Dev and Legal Defense Fund lockbox requiring community approval for disbursements, require ZCG to contribute 50,000 ZEC to the NSM, and preserve ZCG and its grant program with its remaining treasury.' },
  6: { title: 'Do you support the Zcash Adoption Pool (ZAP) proposal?', link: `${F}58656`, summary: 'This proposal would retain ZCG\'s existing treasury and continue its 8% funding stream through November 2028. It would rename the grant program and its pool of funds to Zcash Adoption Pool, consistent with using those funds to increase Zcash and ZEC adoption as broadly as possible. It would also leave open the possibility of using funds from the existing treasury for development and legal defense.' },
  7: { title: 'Do you support maintaining ZCG\'s existing funding and operations?', summary: 'This is the status quo option. ZCG would continue receiving its 8% funding stream through the November 2028 halving, and its treasury and operations would remain unchanged.' },
  8: { title: 'Assuming it can be done safely in a network upgrade, do you support reducing Zcash\'s target block time from 25 seconds to 20 seconds?', link: `${F}59035`, summary: '' }
};
