/* Retire old night-routing jobs. 18:30 pauses monitoring, never changes Group ID. */
async function runCollectionEvening(state){
 if(state.collectionEvening!=null){
  state.collectionEvening=null;
  await saveState(state);
 }
 Detection.applySchedule(state,Date.now());
}
