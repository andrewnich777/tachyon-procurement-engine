import { day, daysBetween, schedule, total, type QuoteData, type State, type source } from './domain.js';
import type { z } from 'zod';

type Source = z.infer<typeof source>;
export type ResearchIssue = {code:string;field:string;message:string;blocksPurchase:boolean};
export type ChecklistRow = {criterion:string;label:string;status:'supported'|'contradicted'|'unresolved';finding:string;sources:Source[];required:boolean};
type Quote = {id:string;data:QuoteData & {requestRevision:number}};

// This checks recorded evidence and consistency. It does not browse or certify source claims.
export function assessResearch(s:State,quote:Quote|null,now=new Date()) {
  const issues:ResearchIssue[]=[],q=quote?.data;
  const add=(code:string,field:string,message:string,blocksPurchase=false)=>issues.push({code,field,message,blocksPurchase});
  const criteria=[{criterion:'scope',label:'Exact items, variants and quantities',required:true},
    {criterion:'availability',label:'Availability and delivery basis',required:true},
    ...s.data.requirements.map(r=>({criterion:'requirement:'+r.key,label:r.label,required:true})),
    {criterion:'reviews',label:'Ratings and review counts',required:false}];
  const checklist:ChecklistRow[]=criteria.map(c=> {
    const e=q?.evidence?.find(e=>e.criterion===c.criterion);
    let row:ChecklistRow={...c,status:e?.status??'unresolved',finding:e?.finding??'No research finding recorded.',sources:e?.sources??[]};
    if(c.criterion==='scope' && row.status==='supported' && s.data.items.some(i=>!e?.itemKeys?.includes(i.key)))
      row={...row,status:'unresolved',finding:'Scope evidence must identify every request item key it covers.'};
    if(c.criterion==='reviews' && q?.reviews?.length && !e)
      row={...c,status:'supported',finding:'Structured review observations recorded; compare like-for-like sources.',sources:q.reviews.map(r=>r.source)};
    if(c.criterion==='reviews' && row.status==='supported' && !q?.reviews?.length) {
      row={...row,status:'unresolved',finding:'A reviews claim exists without structured rating/count observations.'};
      add('reviews-unstructured','reviews','Save rating, scaleMax, reviewCount, platform, target and source, or explain why reviews are unavailable.');
    }
    if(c.criterion==='availability' && row.status==='supported' && q?.leadDays==null && !q?.promisedDate)
      row={...row,status:'unresolved',finding:'Source evidence is recorded but delivery timing is still unknown.'};
    if(c.criterion==='availability' && row.status==='supported' && e?.site!==s.data.site)
      row={...row,status:'unresolved',finding:'Availability evidence must cover the request destination/site.'};
    if(c.criterion==='availability' && row.status==='supported' &&
      (e?.availability?.basis!=='location-confirmed' || s.data.items.some(i=>!e.availability?.itemKeys.includes(i.key))))
      row={...row,status:'unresolved',finding:'Confirm availability for every item at a specific store or delivery address; a generic pickup listing is not local stock evidence.'};
    if(row.sources.some(source=>Date.parse(source.checkedAt)>+now)) {
      row={...row,status:'unresolved',finding:'Evidence has a future checked-at timestamp; correct it.'};
      add('future-evidence:'+c.criterion,'evidence','Use the actual evidence check time.',true);
    }
    if(row.status==='contradicted') add('contradicted:'+c.criterion,'evidence',`Resolve contradictory evidence for ${c.label}; choose another candidate if needed.`,c.required);
    if(c.required && row.status==='unresolved') add('evidence-missing:'+c.criterion,'evidence',`Investigate and record evidence for ${c.label}, or report the specific unavailable fact.`);
    return row;
  });
  const reviewCoverage=(q?.recommendation??[]).map(item=>{
    const observations=(q?.reviews??[]).filter(r=>r.recommendationKey===item.key && r.subject===item.subject && r.itemKey===item.itemKey && r.target.trim().toLowerCase()===item.target.trim().toLowerCase() && Date.parse(r.source.checkedAt)<=+now);
    const checked=(sources:Source[]|undefined)=>!!sources?.length && sources.every(s=>Date.parse(s.checkedAt)<=+now);
    const reviewStatus=observations.length?'observed':item.reviewGap && checked(item.reviewGap.sources)?'unavailable':'missing';
    const comparison=item.comparison;
    const compared=!!comparison && (comparison.alternatives.length>0
      ?comparison.alternatives.every(a=>a.target.trim().toLowerCase()!==item.target.trim().toLowerCase() && checked(a.sources))
      :!!comparison.noAlternative && checked(comparison.noAlternative.sources));
    if(reviewStatus==='missing') add('reviews-missing:'+item.key,'recommendation','Investigate ratings and review counts for '+item.target+'; save linked observations or a sourced explanation of their absence.');
    if(!compared) add('comparison-missing:'+item.key,'recommendation','Explain why '+item.target+' beats researched alternatives, or document why no relevant alternative was found.');
    return {key:item.key,itemKey:item.itemKey,target:item.target,subject:item.subject,reviewStatus,observations,
      reviewGap:item.reviewGap??null,comparison:comparison??null,compared};
  });
  const coverageComplete=reviewCoverage.length>0 && s.data.items.every(i=>reviewCoverage.some(r=>r.itemKey===i.key));
  if(q && !coverageComplete) add('recommendation-items-missing','recommendation','List every exact product or service provider in the proposed purchase. A generic assortment and a single rating do not establish coverage.');
  const reviewsRow=checklist.find(r=>r.criterion==='reviews')!;
  reviewsRow.required=true;
  reviewsRow.status=coverageComplete && reviewCoverage.every(r=>r.reviewStatus!=='missing')?'supported':'unresolved';
  reviewsRow.finding='Every recommended target needs its own relevant ratings/counts or a sourced explanation of unavailable reviews.';
  reviewsRow.sources=reviewCoverage.flatMap(r=>r.observations.map(o=>o.source).concat(r.reviewGap?.sources??[]));
  checklist.push({criterion:'comparison',label:'Why each recommended target beats alternatives',required:true,
    status:coverageComplete && reviewCoverage.every(r=>r.compared)?'supported':'unresolved',
    finding:'Compare requirement fit, rating/count evidence and price; do not invent ratings or reject specialist items merely for lacking reviews.',
    sources:reviewCoverage.flatMap(r=>r.comparison?.alternatives.flatMap(a=>a.sources).concat(r.comparison.noAlternative?.sources??[])??[])});
  if(!s.constraintProvenance?.confirmed)
    add('constraints-unconfirmed','constraints','The request was captured by an agent or legacy record. Have the requester/owner confirm the captured constraints; do not invent or change them.',true);
  if(q?.leadBasis==='owner-estimate' && q.recordedBy?.role!=='owner')
    add('owner-estimate-unattributed','leadBasis','An owner estimate must be recorded by the authenticated owner. Use agent-estimate for your own assumptions.',true);
  const amount=q?total(q.costs):null;
  const costConfirmed=q?.costBasis==='confirmed' && !!q.costEvidence && Date.parse(q.costEvidence.checkedAt)<=+now;
  if(q && !costConfirmed) add('cost-unconfirmed','costBasis','Final payable cost is estimated or lacks confirmation evidence. Keep the estimate provisional; verify destination-specific charges before commitment.',true);
  checklist.push({criterion:'landed-cost',label:'Final cost within request budget',required:true,
    status:amount===null?'unresolved':q?.currency!==s.data.currency || (s.data.budgetCents!==null&&amount>s.data.budgetCents)?'contradicted':costConfirmed?'supported':'unresolved',
    finding:amount===null?'Resolve shipping, tax, hazmat and other charges.':`${costConfirmed?'Confirmed':'Estimated/unconfirmed'} ${amount} ${q!.currency} minor units; ${s.data.budgetCents===null?'no request budget provided':'request budget '+s.data.budgetCents}.`,sources:q?.costEvidence?[q.costEvidence]:q?.sources??[]});
  if(amount===null) add('landed-cost-unknown','costs','Determine the final payable charges. Do not describe a pretax subtotal as within the total budget.');
  const timing=schedule(s,q??null,day(now));
  checklist.push({criterion:'deadline',label:'Delivery fits the requested deadline',required:true,
    status:!s.data.neededBy||!timing.forecast?'unresolved':timing.late?'contradicted':s.constraintProvenance?.confirmed && q?.leadBasis==='vendor' && checklist.find(r=>r.criterion==='availability')?.status==='supported'?'supported':'unresolved',
    finding:!s.data.neededBy?'Ask when the items or service are needed.':!timing.forecast?'Delivery timing is unknown.':`${timing.forecast} forecast plus ${s.data.bufferDays} buffer days; needed by ${s.data.neededBy}.`,sources:q?.sources??[]});
  if(s.data.neededBy && checklist.find(r=>r.criterion==='deadline')!.status==='unresolved')
    add('deadline-unconfirmed','leadBasis','Keep delivery fit provisional until request constraints and destination-specific supplier timing are confirmed.');
  if(!s.data.neededBy) add('needed-by-missing','neededBy','Ask for the needed-by date so delivery fit and order-by can be assessed.');
  if(q) {
    if(q.requestRevision!==s.revision) {
      add('scope-stale','requestRevision','Save a new quote and findings against the current request revision.',true);
      for(const row of checklist) {row.status='unresolved';row.finding='This quote belongs to an earlier request revision; reassess current requirements.';}
    }
    if(q.priceBasis!=='list-snapshot' && /(?:^|[.;\n])\s*(?:list[ -]price|catalog[ -]price|list[ -]snapshot)\b/i.test(q.terms+'\n'+q.summary))
      add('price-basis-mismatch','priceBasis','The text describes catalog pricing. Save a new quote with priceBasis "list-snapshot" and its actual priceCheckedAt, or correct the text if this is a formal quote.',true);
    if(q.priceBasis==='list-snapshot' && (!q.priceCheckedAt || Date.parse(q.priceCheckedAt)>+now || daysBetween(day(new Date(q.priceCheckedAt)),day(now))>7))
      add('catalog-price-stale','priceCheckedAt','Recheck the catalog price and record the actual check timestamp within seven calendar days.');
    const availability=checklist.find(row=>row.criterion==='availability')!;
    if(q.leadBasis==='vendor' && (q.leadDays!==null || q.promisedDate!==null) && availability.status!=='supported')
      add('vendor-timing-unsupported','leadBasis','Vendor-confirmed timing needs supported availability evidence. Record the source and relevant site/variant, or use an honest estimate basis and leave unknown dates null.',true);
    if(q.priceBasis!=='list-snapshot' && (!q.expiresOn || q.expiresOn<day(now)))
      add('formal-quote-validity','expiresOn','Obtain formal quote validity, or use list-snapshot for a researched catalog price.');
    if(q.sources.some(source=>Date.parse(source.checkedAt)>+now) || q.reviews?.some(r=>Date.parse(r.source.checkedAt)>+now))
      add('future-source','sources','Correct future source/review check timestamps.',true);
  } else add('quote-missing','quote','Research and save a candidate quote.');
  return {quoteId:quote?.id??null,requestRevision:s.revision,
    readyToRecommend:!!q && checklist.filter(r=>r.required).every(r=>r.status==='supported') && !issues.length,
    checklist,issues,reviews:q?.reviews??[],reviewCoverage,
    researchPermission:{approvalRequired:false,minimumWorkers:3,note:'Continue permitted research and native delegation while purchase/constraint gates remain blocked. Do not claim workers ran unless they did.'},
    provenance:{constraints:s.constraintProvenance??null,quote:q?.recordedBy??null},
    costBasis:q?.costBasis??'unknown',timingBasis:q?.leadBasis??null,
    evidenceMeaning:'Source-linked research assertions, not independent fact verification or purchasing authorization.'};
}
