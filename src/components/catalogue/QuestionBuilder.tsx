"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { CheckCircle2, GripVertical } from "lucide-react";
import { ResourceForm } from "@/components/primitives";
import { moveItemInContainers } from "./ArrangeBoard";
import { useUnsavedOrder } from "./UnsavedOrderGuard";
import { evaluateAssessmentReadiness, type AssessmentReadinessInput } from "@/server/services/assessment-readiness";
import type { QuestionDraft } from "@/server/services/assessment-service";

export type QuestionSaveResult = { ok: true; totalMarks: number } | { ok: false; message: string };
type Draft = Omit<QuestionDraft, "options"> & { key: string; options: Array<QuestionDraft["options"][number] & { key: string }> };
type Props = {
  assessmentId: string;
  initialQuestions: QuestionDraft[];
  readinessInput?: Partial<Omit<AssessmentReadinessInput, "questions">>;
  onSubmit(input: { assessmentId: string; questions: QuestionDraft[] }): Promise<QuestionSaveResult>;
};
const INPUT = "w-full rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground";
const BTN = "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";

function keyed(question: QuestionDraft, key: string): Draft {
  return { ...question, key, options: question.options.map((option,i) => ({ ...option, key: `${key}-o${i}` })) };
}
function payload(questions: Draft[]): QuestionDraft[] {
  return questions.map(q => ({ prompt:q.prompt, type:q.type, marks:q.marks, explanation:q.explanation, options:q.options.map(o => ({label:o.label,isCorrect:o.isCorrect})) }));
}
function move<T extends { key: string }>(items: T[], from: number, to: number): T[] {
  const containers = [{ id:"items", label:"Items", items:items.map(item => ({id:item.key,label:item.key})) }];
  const result = moveItemInContainers(containers,{droppableId:"items",index:from},{droppableId:"items",index:to});
  const byId = new Map(items.map(item => [item.key,item]));
  return result[0].items.map(item => byId.get(item.id)!);
}

export function QuestionBuilder({ assessmentId, initialQuestions, readinessInput, onSubmit }: Props) {
  const [questions,setQuestions] = useState(() => initialQuestions.map((q,i) => keyed(q,`q${i}`)));
  const counter = useRef(initialQuestions.length);
  const [saved,setSaved] = useState(() => JSON.stringify(initialQuestions));
  const [pending,startTransition] = useTransition();
  const [error,setError] = useState<string | null>(null);
  const [removing,setRemoving] = useState<string | null>(null);
  const [announcement,setAnnouncement] = useState("");
  const id = useId();
  const {setDirty} = useUnsavedOrder();
  const dirty = JSON.stringify(payload(questions)) !== saved;
  useEffect(() => { setDirty(dirty,id); return () => setDirty(false,id); },[dirty,id,setDirty]);

  const defects = evaluateAssessmentReadiness({
    type:"QUIZ",title:"Quiz",instructions:null,availableFrom:null,availableUntil:null,dueAt:null,
    maxAttempts:null,passMark:null,totalMarks:questions.reduce((sum,q)=>sum+q.marks,0),
    attemptGradingMethod:"HIGHEST",feedbackBehaviour:"ON_RELEASE",allowedFileTypes:[],maxFileSizeBytes:null,allowResubmission:false,
    ...readinessInput,
    questions:questions.map((q,i)=>({...q,position:i,options:q.options.map((o,j)=>({...o,position:j}))})),
  }).filter(item => item.blocking && item.state === "FAIL");

  function change(key: string, update: Partial<Draft>) {
    setQuestions(current => current.map(q => q.key === key ? {...q,...update} : q));
  }
  function changeType(q: Draft, type: QuestionDraft["type"]) {
    const options = type === "TRUE_FALSE"
      ? [{key:`${q.key}-true`,label:"True",isCorrect:false},{key:`${q.key}-false`,label:"False",isCorrect:false}]
      : q.options.map((o,i) => ({...o,isCorrect:type === "SINGLE_CHOICE" ? i === q.options.findIndex(v=>v.isCorrect) : o.isCorrect}));
    change(q.key,{type,options});
  }
  function reorderQuestion(from: number, to: number) {
    if (to < 0 || to >= questions.length || from === to) return;
    setQuestions(current => move(current,from,to));
    setAnnouncement(`Question ${from+1} moved to position ${to+1} of ${questions.length}`);
  }
  function reorderOption(q: Draft, from: number, to: number) {
    if (to < 0 || to >= q.options.length || from === to) return;
    change(q.key,{options:move(q.options,from,to)});
    setAnnouncement(`Option ${from+1} moved to position ${to+1}`);
  }
  function dragEnd(result: DropResult) {
    if (!result.destination || result.source.droppableId !== result.destination.droppableId) return;
    if (result.source.droppableId === "questions") reorderQuestion(result.source.index,result.destination.index);
    else {
      const q=questions.find(q => `options-${q.key}` === result.source.droppableId);
      if(q) reorderOption(q,result.source.index,result.destination.index);
    }
  }
  function save() {
    const ordered=payload(questions);
    setError(null);
    startTransition(async()=>{
      try {
        const result=await onSubmit({assessmentId,questions:ordered});
        if(!result.ok) { setError(result.message); return; }
        setSaved(JSON.stringify(ordered));
        setAnnouncement(`Questions saved. Total marks: ${result.totalMarks}.`);
      } catch { setError("Questions could not be saved. Your edits are still here. Try again."); }
    });
  }
  const keyboardMove = (event: React.KeyboardEvent, callback:()=>void) => {
    if(event.key === "Enter" || event.key === " ") {event.preventDefault();callback();}
  };

  return <ResourceForm title="Quiz questions" submitLabel="Save questions" pending={pending}
    errors={error ? [{name:"questions",message:error}] : []} onSubmit={save}>
    <div role="status" aria-live="polite" aria-label="Question order" className="sr-only">{announcement}</div>
    {dirty && <p className="w-fit rounded-full border border-warning/30 bg-warning/10 px-4 py-1 text-[11px] font-semibold text-warning">Unsaved changes</p>}
    {questions.length === 0 && <p className="text-sm text-muted-foreground">No questions yet. Add a question to get started.</p>}
    <fieldset disabled={pending} className="min-w-0">
      <DragDropContext onDragEnd={dragEnd}>
        <Droppable droppableId="questions" type="QUESTION">
          {(provided,snapshot)=><div ref={provided.innerRef} {...provided.droppableProps}
            className={`flex flex-col gap-6 ${snapshot.isDraggingOver ? "outline-2 outline-dashed outline-accent" : ""}`}>
            {questions.map((q,index)=><Draggable key={q.key} draggableId={q.key} index={index}>
              {(drag,dragging)=><fieldset ref={drag.innerRef} {...drag.draggableProps} aria-label={`Question ${index+1}`}
                className={`min-w-0 rounded-xl border border-border bg-surface p-4 shadow-xs ${dragging.isDragging ? "outline-2 outline-dashed outline-accent" : ""}`}>
                <legend className="text-base font-semibold">Question {index+1}</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" {...drag.dragHandleProps} aria-label={`Drag question ${index+1}`} className={BTN}><GripVertical aria-hidden="true" size={16}/></button>
                  <button type="button" className={BTN} disabled={index===0} aria-label={`Move question ${index+1} up`} onClick={()=>reorderQuestion(index,index-1)} onKeyDown={e=>keyboardMove(e,()=>reorderQuestion(index,index-1))}>Move up</button>
                  <button type="button" className={BTN} disabled={index===questions.length-1} aria-label={`Move question ${index+1} down`} onClick={()=>reorderQuestion(index,index+1)} onKeyDown={e=>keyboardMove(e,()=>reorderQuestion(index,index+1))}>Move down</button>
                  {removing===q.key ? <>
                    <span className="text-sm">Remove this question?</span>
                    <button type="button" className={BTN} aria-label={`Confirm remove question ${index+1}`} onClick={()=>{setQuestions(current=>current.filter(v=>v.key!==q.key));setRemoving(null);}}>Remove</button>
                    <button type="button" className={BTN} onClick={()=>setRemoving(null)}>Keep question</button>
                  </> : <button type="button" className={BTN} aria-label={`Remove question ${index+1}`} onClick={()=>setRemoving(q.key)}>Remove</button>}
                </div>
                <div className="mt-4 flex flex-col gap-4">
                  <label className="text-sm">Prompt<textarea aria-label={`Question ${index+1} prompt`} className={`${INPUT} text-base font-semibold`} value={q.prompt} onChange={e=>change(q.key,{prompt:e.target.value})}/></label>
                  <label className="text-sm">Type<select aria-label={`Question ${index+1} type`} className={INPUT} value={q.type} onChange={e=>changeType(q,e.target.value as QuestionDraft["type"])}>
                    <option value="SINGLE_CHOICE">Single choice</option><option value="MULTI_CHOICE">Multiple choice</option><option value="TRUE_FALSE">True / False</option>
                  </select></label>
                  <label className="text-sm">Marks<input aria-label={`Question ${index+1} marks`} className={INPUT} type="number" min={1} step={1} value={Number.isNaN(q.marks) ? "" : q.marks} onChange={e=>change(q.key,{marks:e.target.valueAsNumber})}/></label>
                  <label className="text-sm">Explanation (optional)<textarea aria-label={`Question ${index+1} explanation`} className={INPUT} value={q.explanation ?? ""} onChange={e=>change(q.key,{explanation:e.target.value || null})}/></label>
                  {q.type==="MULTI_CHOICE" && <p className="text-sm text-muted-foreground">Correct choices earn partial credit. Selecting extra wrong options loses marks, down to zero.</p>}
                  <Droppable droppableId={`options-${q.key}`} type={`OPTION-${q.key}`}>
                    {(optionsProvided)=><div ref={optionsProvided.innerRef} {...optionsProvided.droppableProps} className="flex flex-col gap-2">
                      {q.options.map((option,oi)=><Draggable key={option.key} draggableId={option.key} index={oi}>
                        {(optionDrag)=><div ref={optionDrag.innerRef} {...optionDrag.draggableProps} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-4">
                          {q.type!=="TRUE_FALSE" && <button type="button" className={BTN} {...optionDrag.dragHandleProps} aria-label={`Drag question ${index+1} option ${oi+1}`}><GripVertical aria-hidden="true" size={16}/></button>}
                          {q.type==="TRUE_FALSE" ? <span className="text-sm">{option.label}</span> : <input aria-label={`Question ${index+1} option ${oi+1} label`} className={`${INPUT} flex-1`} value={option.label} onChange={e=>change(q.key,{options:q.options.map(o=>o.key===option.key ? {...o,label:e.target.value} : o)})}/>}
                          <label className="flex items-center gap-2 text-sm">
                            <input aria-label={`Question ${index+1} option ${oi+1} correct`} className="size-4 border-[1.5px] border-input-border accent-accent" type={q.type==="MULTI_CHOICE" ? "checkbox" : "radio"} name={`${id}-${q.key}-correct`} checked={option.isCorrect}
                              onChange={e=>change(q.key,{options:q.options.map(o=>({...o,isCorrect:o.key===option.key ? e.target.checked : q.type==="MULTI_CHOICE" ? o.isCorrect : false}))})}/>
                            {option.isCorrect && <CheckCircle2 aria-hidden="true" size={16} className="text-success"/>}Correct
                          </label>
                          {q.type!=="TRUE_FALSE" && <>
                            <button type="button" className={BTN} disabled={oi===0} aria-label={`Move question ${index+1} option ${oi+1} up`} onClick={()=>reorderOption(q,oi,oi-1)}>Move up</button>
                            <button type="button" className={BTN} disabled={oi===q.options.length-1} aria-label={`Move question ${index+1} option ${oi+1} down`} onClick={()=>reorderOption(q,oi,oi+1)}>Move down</button>
                            <button type="button" className={BTN} aria-label={`Remove question ${index+1} option ${oi+1}`} onClick={()=>change(q.key,{options:q.options.filter(o=>o.key!==option.key)})}>Remove option</button>
                          </>}
                        </div>}
                      </Draggable>)}
                      {optionsProvided.placeholder}
                    </div>}
                  </Droppable>
                  {q.type!=="TRUE_FALSE" && <button type="button" className={BTN} onClick={()=>change(q.key,{options:[...q.options,{key:`o${counter.current++}`,label:"",isCorrect:false}]})}>Add option</button>}
                  <ul className="text-sm text-danger">{defects.filter(item=>item.id.startsWith(`assessment.question.${index}.`)).map(item=><li key={item.id}>{item.label}</li>)}</ul>
                </div>
              </fieldset>}
            </Draggable>)}
            {provided.placeholder}
          </div>}
        </Droppable>
      </DragDropContext>
      <button type="button" className={`${BTN} mt-4`} onClick={()=>setQuestions(current=>[...current,keyed({prompt:"",type:"SINGLE_CHOICE",marks:1,explanation:null,options:[{label:"",isCorrect:false},{label:"",isCorrect:false}]},`q${counter.current++}`)])}>Add question</button>
    </fieldset>
  </ResourceForm>;
}
