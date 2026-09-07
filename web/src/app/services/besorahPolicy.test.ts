import { expect, test } from "bun:test";
import { assertBesorahPublishable } from "../../../../scripts/generate-static-data/besorah-policy";
const verse=(text:string,strong:string|null,status?:string)=>[{verse:1,words:[{text,strong,mapping_review:{status}}]}];
test("static and offline publication blocks artifacts and unapproved candidates",()=>{
  expect(()=>assertBesorahPublishable(verse("בּוֹ","D0208","accepted"),"fixture")).not.toThrow();
  expect(()=>assertBesorahPublishable(verse("בּוֹ",null,"needs_review"),"fixture")).not.toThrow();
  for(const value of [verse("WO","H2245"),verse("׃","H539"),verse("בּוֹ","H120","needs_review"),verse("בּוֹ","wrong"),[...verse("בּוֹ","D0208"),...verse("בּוֹ","D0208")]]) {
    expect(()=>assertBesorahPublishable(value,"fixture")).toThrow();
  }
});
