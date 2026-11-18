import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLanguageId, javaClassName } from '../src/judge/languages';

test('javaClassName：识别 public class', () => {
  assert.equal(javaClassName('public class Solution { }'), 'Solution');
});

test('javaClassName：public final class 也识别', () => {
  assert.equal(javaClassName('public final class Main { }'), 'Main');
});

test('javaClassName：只有 package 私有 class 时取第一个', () => {
  assert.equal(javaClassName('class Helper { }\nclass Other { }'), 'Helper');
});

test('javaClassName：注解与修饰符混排', () => {
  assert.equal(javaClassName('@SuppressWarnings("all")\npublic class A1 { }'), 'A1');
});

test('javaClassName：没有类声明时回退 Main', () => {
  assert.equal(javaClassName('System.out.println(1);'), 'Main');
});

test('isLanguageId：合法 id 通过', () => {
  assert.equal(isLanguageId('python'), true);
  assert.equal(isLanguageId('cpp'), true);
});

test('isLanguageId：原型链上的键必须被拒绝', () => {
  assert.equal(isLanguageId('toString'), false);
  assert.equal(isLanguageId('constructor'), false);
  assert.equal(isLanguageId('hasOwnProperty'), false);
});

test('isLanguageId：非字符串与未知语言被拒绝', () => {
  assert.equal(isLanguageId(null), false);
  assert.equal(isLanguageId(1), false);
  assert.equal(isLanguageId('rust'), false);
});
