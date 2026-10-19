import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { userCodeLayout } from '../userCode';

test('generated folds leave every user-code line and both markers visible', () => {
  const text = ['generated header', 'generated include', '/* USER CODE BEGIN Includes */', '#include "mine.h"', '/* USER CODE END Includes */',
    'int main(void)', '{', '  HAL_Init();', '  /* USER CODE BEGIN 2 */', '  user_init();', '  /* USER CODE END 2 */', '  generated_init();',
    '  /* USER CODE BEGIN WHILE */', '  while (1) {', '  /* USER CODE END WHILE */', '', '  /* USER CODE BEGIN 3 */', '    user_loop();', '  }', '  /* USER CODE END 3 */', '}', 'generated footer'].join('\n');
  const layout = userCodeLayout(text);
  assert.equal(layout.issues.length, 0);
  assert.equal(layout.blocks.length, 4);
  for (const block of layout.blocks) for (let line = block.start; line <= block.end; line++) {
    assert.ok(!layout.generated.some(range => line > range.start && line <= range.end), `user line ${line} would be hidden`);
  }
  assert.ok(layout.generated.some(range => 7 > range.start && 7 <= range.end), 'HAL_Init is hidden');
  assert.ok(layout.generated.some(range => 11 > range.start && 11 <= range.end), 'generated_init is hidden');
});

test('nested user blocks protect the complete outer block', () => {
  const text = ['/* USER CODE BEGIN Outer */', 'outer();', '/* USER CODE BEGIN Inner */', 'inner();', '/* USER CODE END Inner */', 'still_outer();', '/* USER CODE END Outer */', 'generated();'].join('\n');
  const layout = userCodeLayout(text);
  assert.equal(layout.blocks.length, 2);
  assert.deepEqual(layout.generated, [{ start: 6, end: 7 }]);
});

test('incomplete and mismatched markers never hide code', () => {
  for (const text of [
    '/* USER CODE BEGIN 1 */\nmy_code();',
    '/* USER CODE END 1 */\nmy_code();',
    '/* USER CODE BEGIN 1 */\nmy_code();\n/* USER CODE END 2 */',
    '/* USER CODE BEGIN 1 */\nx();\n/* USER CODE END 1 */\n/* USER CODE BEGIN 2 */\ny();'
  ]) {
    const layout = userCodeLayout(text);
    assert.ok(layout.issues.length);
    assert.deepEqual(layout.generated, []);
  }
});

test('CRLF, BOM, empty slots and repeated labels are supported', () => {
  const layout = userCodeLayout('\ufeff/* USER CODE BEGIN 0 */\r\n/* USER CODE END 0 */\r\ngenerated();\r\n/* USER CODE BEGIN 0 */\r\n\r\n/* USER CODE END 0 */');
  assert.equal(layout.issues.length, 0);
  assert.equal(layout.blocks.length, 2);
  assert.deepEqual(layout.generated, [{ start: 1, end: 2 }]);
});

test('files without markers and marker-shaped string literals remain unchanged', () => {
  for (const text of ['', 'int main(void) { return 0; }', 'const char *s = "/* USER CODE BEGIN Fake */";']) {
    assert.deepEqual(userCodeLayout(text), { blocks: [], generated: [], issues: [] });
  }
});

test('function signatures, multiline parameters and closing braces remain visible', () => {
  const lines = [
    '/* USER CODE BEGIN Includes */', '#include "mine.h"', '/* USER CODE END Includes */',
    'void SystemClock_Config(void);',
    'int main(void)', '{', '  HAL_Init();',
    '  /* USER CODE BEGIN 2 */', '  start();', '  /* USER CODE END 2 */', '  MX_GPIO_Init();',
    '  /* USER CODE BEGIN 3 */', '  loop();', '  /* USER CODE END 3 */', '}',
    'static void', 'MX_GPIO_Init(', '  void', ')', '{', '  generated_gpio();',
    '  /* USER CODE BEGIN MX_GPIO_Init_2 */', '  custom_gpio();', '  /* USER CODE END MX_GPIO_Init_2 */', '}',
    '__weak void HAL_Callback(void) {', '  generated_callback();', '}',
  ];
  const { generated } = userCodeLayout(lines.join('\n'));
  const hidden = (line: number) => generated.some(range => range.start < line && line <= range.end);
  for (const line of [4, 5, 14, 15, 16, 17, 18, 19, 24, 25, 27]) assert.equal(hidden(line), false, `function landmark ${line}: ${lines[line]}`);
  for (const line of [3, 6, 10, 20, 26]) assert.equal(hidden(line), true, `generated code ${line} should fold`);
});

test('comments, strings, continued macros and control blocks do not create function landmarks', () => {
  const lines = [
    '/* USER CODE BEGIN 0 */', '/* USER CODE END 0 */',
    '#define FAKE(x) \\', '  void macro_fake(void) { macro_body(); }',
    '/* void commented(void) { */', 'const char *s = "void quoted(void) {";',
    'void real(void)', '{', '  if (ready()) {', '    generated();', '  }',
    '  for (int i = 0; i < 3; i++) {', '    generated();', '  }',
    '  /* USER CODE BEGIN 1 */', '  mine();', '  /* USER CODE END 1 */', '}',
  ];
  const { generated } = userCodeLayout(lines.join('\r\n'));
  const hidden = (line: number) => generated.some(range => range.start < line && line <= range.end);
  for (const line of [2, 3, 4, 5, 8, 9, 10, 11, 12, 13]) assert.equal(hidden(line), true, `non-function line ${line} should fold`);
  for (const line of [6, 7, 14, 15, 16, 17]) assert.equal(hidden(line), false, `context or user line ${line} hidden`);
});
