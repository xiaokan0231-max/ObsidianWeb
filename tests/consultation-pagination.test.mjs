import assert from "node:assert/strict";
import test from "node:test";
import { consultationPage, paginationPageNumbers } from "../lib/consultation-pagination.ts";

const records = Array.from({ length: 14 }, (_, index) => ({ id: `example-${index + 1}` }));

test("完整列表每页默认六条，末页给出准确范围且不改变原数组", () => {
  const before = [...records];
  const first = consultationPage(records, 1);
  assert.deepEqual(first, { items: records.slice(0, 6), page: 1, pageCount: 3, total: 14, start: 1, end: 6 });
  const last = consultationPage(records, 3);
  assert.deepEqual(last, { items: records.slice(12), page: 3, pageCount: 3, total: 14, start: 13, end: 14 });
  assert.deepEqual(records, before);
  assert.notEqual(first.items, records);
});

test("筛选后页数缩小或输入异常时，页码回到合法范围", () => {
  assert.equal(consultationPage(records, 99).page, 3);
  assert.equal(consultationPage(records.slice(0, 2), 3).page, 1);
  assert.equal(consultationPage(records, 2.9).page, 2);
  for (const page of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(consultationPage(records, page).page, 1);
  }
});

test("空列表维持可表示的第一页并显示零条范围", () => {
  assert.deepEqual(consultationPage([], 100), { items: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0 });
});

test("页大小支持正整数，非法大小使用默认值", () => {
  assert.deepEqual(consultationPage(records, 2, 4).items, records.slice(4, 8));
  assert.equal(consultationPage(records, 2, 4.8).end, 8);
  for (const size of [0, -1, NaN, Infinity]) {
    assert.equal(consultationPage(records, 1, size).items.length, 6);
  }
});

test("页码按钮最多五个，居中连续并在两端保持完整窗口", () => {
  assert.deepEqual(paginationPageNumbers(1, 10), [1, 2, 3, 4, 5]);
  assert.deepEqual(paginationPageNumbers(6, 10), [4, 5, 6, 7, 8]);
  assert.deepEqual(paginationPageNumbers(10, 10), [6, 7, 8, 9, 10]);
  assert.deepEqual(paginationPageNumbers(2, 3), [1, 2, 3]);
  assert.deepEqual(paginationPageNumbers(1, 1), [1]);
});

test("页码窗口处理越界与异常输入，不产生零或重复页码", () => {
  assert.deepEqual(paginationPageNumbers(99, 7), [3, 4, 5, 6, 7]);
  assert.deepEqual(paginationPageNumbers(-2, 7), [1, 2, 3, 4, 5]);
  assert.deepEqual(paginationPageNumbers(NaN, Infinity), [1]);
  for (let count = 1; count <= 15; count += 1) {
    for (let page = 1; page <= count; page += 1) {
      const numbers = paginationPageNumbers(page, count);
      assert.ok(numbers.includes(page));
      assert.ok(numbers.length <= 5);
      assert.equal(new Set(numbers).size, numbers.length);
      assert.ok(numbers.every(number => number >= 1 && number <= count));
    }
  }
});
