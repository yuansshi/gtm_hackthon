import {commercialIntakeKey} from './commercial-planning.js';
import {capabilityIntakeKey,productDescriptionField} from './product-intake.js';
export const intakeFieldValue=(state,field)=>{
  if(field===productDescriptionField)return state.company?.description;
  const capability=capabilityIntakeKey(field);
  if(capability)return state.capabilities?.[capability]?.value;
  const commercial=commercialIntakeKey(field);
  return commercial?state.commercial?.[commercial]:state.icp?.[field];
};
