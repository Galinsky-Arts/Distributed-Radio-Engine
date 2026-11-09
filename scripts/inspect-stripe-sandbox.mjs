import {inspectStripeSandboxAccount} from '../src/stripe-checkout.mjs';
try {console.log(JSON.stringify(await inspectStripeSandboxAccount({apiKey:process.env.STRIPE_SECRET_KEY})));}
catch(error){console.error(JSON.stringify({error:error.code??'STRIPE_ACCOUNT_UNAVAILABLE'}));process.exitCode=1;}
