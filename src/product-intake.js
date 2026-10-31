export const productDescriptionField='company.description';
export const capabilityIntakeKey=field=>typeof field==='string'?/^capabilities\.([a-z][a-z0-9_]*)$/.exec(field)?.[1]||null:null;
export const isProductIntakeField=field=>field===productDescriptionField||!!capabilityIntakeKey(field);
export const productIntakeFields=business=>[
  {field:productDescriptionField,label:'Product description',maxLength:3000},
  ...(business?.capabilities||[]).map(([key,label])=>({field:'capabilities.'+key,label,maxLength:3000})),
];
