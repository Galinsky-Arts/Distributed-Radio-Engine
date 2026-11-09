import {id,assertObject} from './contracts.mjs';
const FORMULA='gentle-quadratic-exp-v1';
const ceilDiv=(n,d)=>(n+d-1n)/d;
function boundedInteger(value,name,{positive=false,digits=64}={}) {
  if(typeof value!=='bigint'||value<(positive?1n:0n)||value.toString().length>digits)
    throw new RangeError('Invalid '+name+' or resource bound');
  return value;
}
function tier(value) {
  if(typeof value==='number') {
    if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Nonnegative exact tier required');
    value=BigInt(value);
  }
  return boundedInteger(value,'tier',{digits:1000});
}
export function createRewardPricePolicy(input) {
  assertObject(input,'price policy');
  const allowed=['creatorId','version','basePoints','gentleNumerator','gentleDenominator',
    'accelerationNumerator','accelerationDenominator','formulaVersion','unit'];
  if(Object.keys(input).some(key=>!allowed.includes(key))||
      (input.formulaVersion!==undefined&&input.formulaVersion!==FORMULA)||
      (input.unit!==undefined&&input.unit!=='micro-reference-seconds'))
    throw new RangeError('Unsupported price policy settings');
  const {creatorId,version,basePoints,gentleNumerator=1n,gentleDenominator=20n,
    accelerationNumerator=1n,accelerationDenominator=100n}=input;
  id(creatorId,'creatorId');
  if(!Number.isSafeInteger(version)||version<1)throw new RangeError('Versioned policy required');
  boundedInteger(basePoints,'base',{positive:true,digits:1000});
  boundedInteger(gentleNumerator,'gentle growth');boundedInteger(gentleDenominator,'gentle denominator',{positive:true});
  boundedInteger(accelerationNumerator,'acceleration');boundedInteger(accelerationDenominator,'acceleration denominator',{positive:true});
  return Object.freeze({creatorId,version,basePoints,gentleNumerator,gentleDenominator,
    accelerationNumerator,accelerationDenominator,formulaVersion:FORMULA,unit:'micro-reference-seconds'});
}
function checkedPolicy(policy) {
  assertObject(policy,'price policy');
  const result=createRewardPricePolicy(policy);
  if(policy.formulaVersion!==FORMULA||policy.unit!==result.unit)throw new RangeError('Unsupported price formula/unit');
  return result;
}
function expBounds(n,d,precision,maxTerms) {
  const scale=10n**BigInt(precision);let squares=0;
  while(2n*n>d){d*=2n;squares++;}
  let low=scale,high=scale,termLow=scale,termHigh=scale,complete=false;
  for(let k=1;k<=maxTerms;k++) {
    termLow=termLow*n/(d*BigInt(k));termHigh=ceilDiv(termHigh*n,d*BigInt(k));
    low+=termLow;high+=termHigh;
    const nextHigh=ceilDiv(termHigh*n,d*BigInt(k+1));
    if(nextHigh<=1n) {high+=2n*nextHigh;complete=true;break;}
  }
  if(!complete)return null;
  for(let k=0;k<squares;k++) {low=low*low/scale;high=ceilDiv(high*high,scale);}
  return {low,high,scale};
}

/**
 * Exact ceil(base * (1 + gentle*tier) * exp(acceleration*tier^2)).
 * There is no business maximum tier. Resource-limited quotes stay symbolic,
 * never clamp/overflow or masquerade as a chargeable integer price.
 */
export function rewardPrice(options) {
  assertObject(options,'quote options');
  if(['maxLevel','multiplierNumerator','multiplierDenominator'].some(key=>Object.hasOwn(options,key)))
    throw new RangeError('Legacy bounded multiplier ladder is unsupported; use a versioned price policy');
  const allowed=['policy','basePoints','creatorId','version','level','maxMaterializedDigits','maxSeriesTerms'];
  if(Object.keys(options).some(key=>!allowed.includes(key))||
      (options.policy&&['basePoints','creatorId','version'].some(key=>Object.hasOwn(options,key))))
    throw new RangeError('Unsupported or ambiguous quote settings');
  const policy=options.policy?checkedPolicy(options.policy):createRewardPricePolicy({
    creatorId:options.creatorId??'unscoped-quote',version:options.version??1,basePoints:options.basePoints});
  const level=tier(options.level);
  const maxDigits=options.maxMaterializedDigits??1000,maxTerms=options.maxSeriesTerms??2048;
  if(!Number.isSafeInteger(maxDigits)||maxDigits<1||maxDigits>1000||
      !Number.isSafeInteger(maxTerms)||maxTerms<1||maxTerms>4096)throw new RangeError('Invalid quote resource budget');
  const linear=policy.gentleDenominator+policy.gentleNumerator*level;
  const numerator=policy.accelerationNumerator*level*level,denominator=policy.accelerationDenominator;
  const formula=Object.freeze({base:policy.basePoints.toString(),tier:level.toString(),
    gentleNumerator:policy.gentleNumerator.toString(),gentleDenominator:policy.gentleDenominator.toString(),
    accelerationNumerator:policy.accelerationNumerator.toString(),accelerationDenominator:denominator.toString()});
  const shared={level,creatorId:policy.creatorId,policyVersion:policy.version,formulaVersion:FORMULA,
    unit:policy.unit,formula,spendAuthorized:false};
  const symbolic=reason=>Object.freeze({...shared,kind:'symbolic',points:null,reason});
  // e < 3 and 3^2 < 10 supply an integer conservative digit bound.
  const digitBound=ceilDiv(ceilDiv(numerator,denominator),2n)+BigInt(policy.basePoints.toString().length)+
    BigInt(linear.toString().length)+2n;
  if(numerator===0n) {
    const points=ceilDiv(policy.basePoints*linear,policy.gentleDenominator);
    if(points.toString().length>maxDigits)return symbolic('materialization-budget');
    return Object.freeze({...shared,kind:'quoted',points});
  }
  if(digitBound>BigInt(maxDigits))return symbolic('materialization-budget');
  for(const guard of [32,64,128]) {
    const bounds=expBounds(numerator,denominator,Number(digitBound)+guard,maxTerms);
    if(!bounds)return symbolic('series-budget');
    const divisor=policy.gentleDenominator*bounds.scale;
    const lower=policy.basePoints*linear*bounds.low/divisor+1n;
    const upper=ceilDiv(policy.basePoints*linear*bounds.high,divisor);
    if(lower===upper) {
      if(upper.toString().length>maxDigits)return symbolic('materialization-budget');
      return Object.freeze({...shared,kind:'quoted',points:upper});
    }
  }
  return symbolic('precision-budget');
}

export function createOfferPriceSnapshot({offerId,offerVersion,policy,level,overridePoints,verifyApproval}) {
  id(offerId,'offerId');policy=checkedPolicy(policy);level=tier(level);
  if(!Number.isSafeInteger(offerVersion)||offerVersion<1||typeof verifyApproval!=='function')
    throw new TypeError('Versioned offer and creator approval verifier required');
  let points,pricing;
  if(overridePoints!==undefined) {
    points=boundedInteger(overridePoints,'creator override',{positive:true,digits:1000});pricing='creator-override';
  } else {
    const quote=rewardPrice({policy,level});
    if(quote.kind!=='quoted')throw new RangeError('Symbolic quote cannot become an executable offer price');
    points=quote.points;pricing='default';
  }
  const record=Object.freeze({offerId,offerVersion,creatorId:policy.creatorId,policyVersion:policy.version,
    formulaVersion:FORMULA,level,points,pricing,unit:policy.unit,spendAuthorized:false});
  let result;
  try {result=verifyApproval(record,policy);}
  catch {throw new RangeError('Creator offer approval failed');}
  if(result&&typeof result.then==='function') {
    Promise.resolve(result).catch(()=>{});throw new TypeError('Synchronous creator approval required');
  }
  if(result!==true)throw new RangeError('Creator offer approval failed');
  return record;
}

