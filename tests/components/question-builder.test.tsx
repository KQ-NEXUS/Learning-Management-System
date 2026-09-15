import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionBuilder } from "@/components/catalogue/QuestionBuilder";
import type { QuestionDraft } from "@/server/services/assessment-service";

const question = (prompt: string): QuestionDraft => ({ prompt, type:"SINGLE_CHOICE", marks:1, explanation:null, options:[{label:"A",isCorrect:true},{label:"B",isCorrect:false}] });
afterEach(cleanup);
function setup(questions: QuestionDraft[] = [question("First"),question("Second")]) {
 const onSubmit=vi.fn(async(_input: {assessmentId:string;questions:QuestionDraft[]})=>({ok:true as const,totalMarks:2}));
 render(<QuestionBuilder assessmentId="a1" initialQuestions={questions} onSubmit={onSubmit}/>);
 return {onSubmit};
}
describe("quiz question builder",()=>{
 it("adds a default single-choice question with one mark",()=>{
  setup([]);fireEvent.click(screen.getByRole('button',{name:'Add question'}));
  expect(screen.getByLabelText('Question 1 type')).toHaveProperty('value','SINGLE_CHOICE');
  expect(screen.getByLabelText('Question 1 marks')).toHaveProperty('value','1');
 });
 it("creates fixed true/false labels and a single correct radio",()=>{
  setup([question('First')]);fireEvent.change(screen.getByLabelText('Question 1 type'),{target:{value:'TRUE_FALSE'}});
  expect(screen.getByText('True')).toBeTruthy();expect(screen.getByText('False')).toBeTruthy();
  expect(screen.queryByLabelText('Question 1 option 1 label')).toBeNull();
  const radios=screen.getAllByRole('radio');fireEvent.click(radios[0]);fireEvent.click(radios[1]);
  expect(radios[0]).toHaveProperty('checked',false);expect(radios[1]).toHaveProperty('checked',true);
 });
 it("keeps single-choice correctness exclusive",()=>{
  setup([question('First')]);const radios=screen.getAllByRole('radio');fireEvent.click(radios[1]);
  expect(radios[0]).toHaveProperty('checked',false);expect(radios[1]).toHaveProperty('checked',true);
 });
 it("allows multiple correct choices and explains partial credit",()=>{
  setup([question('First')]);expect(screen.queryByText(/extra wrong options/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Question 1 type'),{target:{value:'MULTI_CHOICE'}});
  const checks=screen.getAllByRole('checkbox');fireEvent.click(checks[1]);
  expect(checks[0]).toHaveProperty('checked',true);expect(checks[1]).toHaveProperty('checked',true);
  expect(screen.getByText(/extra wrong options/)).toBeTruthy();
 });
 it("reorders by keyboard, announces, and submits the visual order",async()=>{
  const h=setup();fireEvent.keyDown(screen.getByRole('button',{name:'Move question 2 up'}),{key:'Enter'});
  expect(screen.getByLabelText('Question 1 prompt')).toHaveProperty('value','Second');
  expect(screen.getByRole('status',{name:'Question order'}).textContent).toContain('position 1');
  fireEvent.click(screen.getByRole('button',{name:'Save questions'}));
  await waitFor(()=>expect(h.onSubmit).toHaveBeenCalled());
  expect(h.onSubmit.mock.calls[0][0]).toMatchObject({assessmentId:'a1',questions:[{prompt:'Second'},{prompt:'First'}]});
 });
 it("confirms removal and renumbers the remaining question",()=>{
  setup();fireEvent.click(screen.getByRole('button',{name:'Remove question 1'}));
  fireEvent.click(screen.getByRole('button',{name:'Confirm remove question 1'}));
  expect(screen.getByLabelText('Question 1 prompt')).toHaveProperty('value','Second');
  expect(screen.queryByLabelText('Question 2 prompt')).toBeNull();
 });
 it("shows the same blocking prompt defect beside its question",()=>{
  setup([question('')]);const block=screen.getByRole('group',{name:'Question 1'});
  expect(within(block).getByText('Question 1: prompt')).toBeTruthy();
 });
 it("clears dirty state only after a successful save",async()=>{
  setup([question('First')]);fireEvent.change(screen.getByLabelText('Question 1 prompt'),{target:{value:'Edited'}});
  expect(screen.getByText('Unsaved changes')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Save questions'}));
  await waitFor(()=>expect(screen.queryByText('Unsaved changes')).toBeNull());
 });
});
