'use strict';
function fail(code){const error=new Error(code);error.code=code;throw error;}
async function validateSafeAPI(api,{signal}={}){
 if(!api||typeof api.sessionStatus!=='function'||typeof api.smokeTest!=='function'||api.bridge!==undefined||api.client!==undefined||api.vault!==undefined)fail('UNSAFE_OR_OLD_ACTIVATION_API');
 await api.sessionReady;const before=api.sessionStatus();if(!before.connected)fail('SAVED_SESSION_REQUIRED');if(before.cleanupPending||before.ownedResources)fail('EXISTING_OWNED_LIFECYCLE');if(before.readOnly!==true)fail('EXPECTED_READ_ONLY_CANDIDATE');
 if(signal?.aborted)fail('CANCELED');const check=await api.smokeTest({ref:{slug:'pytorch-softmax-from-scratch',planId:'pytorch-basics'},signal});
 if(!check||check.connected!==true||check.accountVerified!==true||check.readOnly!==true||check.transport!=='direct-https'||!Number.isSafeInteger(check.problemCount)||check.problemCount<1||check.problem?.slug!=='pytorch-softmax-from-scratch'||check.problem.hasStatement!==true||check.problem.hasStarterCode!==true||!Number.isSafeInteger(check.problem.testCaseCount))fail('READ_SCHEMA_NOT_CONFIRMED');
 const after=api.sessionStatus();if(after.cleanupPending||after.ownedResources)fail('UNEXPECTED_OWNED_RESOURCES');
 return{accountVerified:true,problemCount:check.problemCount,problem:{slug:check.problem.slug,hasStatement:true,hasStarterCode:true,testCaseCount:check.problem.testCaseCount},browserNeeded:false,credentialValuesExposed:false};
}
module.exports={validateSafeAPI};
