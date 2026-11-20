import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  buildParamString,
  ipInCidr,
  ipInPayfastRanges,
  parseAmountToCents,
  phpUrlencode,
  signPairs,
  signParamString,
} from '../server/payfast.js';

const documented = [
  ['merchant_id', '10000100'],
  ['merchant_key', '46f0cd694581a'],
  ['return_url', 'http://www.yourdomain.co.za/return.php'],
  ['cancel_url', 'http://www.yourdomain.co.za/cancel.php'],
  ['notify_url', 'http://www.yourdomain.co.za/notify.php'],
  ['name_first', 'First Name'],
  ['name_last', 'Last Name'],
  ['email_address', 'test@test.com'],
  ['m_payment_id', '1234'],
  ['amount', '10.00'],
  ['item_name', 'Order#123'],
];

test('signature matches PayFast’s documented PHP example', () => {
  const param = buildParamString(documented);
  assert.equal(
    param,
    'merchant_id=10000100&merchant_key=46f0cd694581a&return_url=http%3A%2F%2Fwww.yourdomain.co.za%2Freturn.php&cancel_url=http%3A%2F%2Fwww.yourdomain.co.za%2Fcancel.php&notify_url=http%3A%2F%2Fwww.yourdomain.co.za%2Fnotify.php&name_first=First+Name&name_last=Last+Name&email_address=test%40test.com&m_payment_id=1234&amount=10.00&item_name=Order%23123',
  );
  assert.equal(signParamString(param, 'jt7NOE43FZPn'), '8317e2bbd1ae2a6f4f36837e83be4ca9');
  assert.equal(signParamString(param, null), 'b8d38028a263acf34dfd2c6e8b62264c');
});

test('PHP urlencode matches the characters PayFast is picky about', () => {
  assert.equal(phpUrlencode('A & B / C'), 'A+%26+B+%2F+C');
  assert.equal(phpUrlencode('a+b@example.com'), 'a%2Bb%40example.com');
  assert.equal(phpUrlencode("p@ss phrase"), 'p%40ss+phrase');
  assert.equal(phpUrlencode("~!*()'"), '%7E%21%2A%28%29%27');
  const edge = [
    ['item_name', 'A & B / C'],
    ['email_address', 'a+b@example.com'],
  ];
  assert.equal(signPairs(edge, 'p@ss phrase'), '3dd3ae39e8acf047822b89c477264690');
});

test('blank fields are left out of the signature, and passphrase is not a field', () => {
  const withBlank = [...documented, ['item_description', '   ']];
  assert.equal(signPairs(withBlank, 'jt7NOE43FZPn'), signPairs(documented, 'jt7NOE43FZPn'));
  assert.equal(buildParamString([['amount', '10.00'], ['signature', 'abc']]), 'amount=10.00');
});

test('node signature matches PHP urlencode and md5 when php is installed', () => {
  const php = spawnSync('php', ['-r', `
    $data = array(
      "merchant_id" => "10000100",
      "merchant_key" => "46f0cd694581a",
      "return_url" => "http://www.yourdomain.co.za/return.php",
      "cancel_url" => "http://www.yourdomain.co.za/cancel.php",
      "notify_url" => "http://www.yourdomain.co.za/notify.php",
      "name_first" => "First Name",
      "name_last" => "Last Name",
      "email_address" => "test@test.com",
      "m_payment_id" => "1234",
      "amount" => "10.00",
      "item_name" => "Order#123"
    );
    $pass = "jt7NOE43FZPn";
    $out = "";
    foreach ($data as $key => $val) {
      if ($val !== "") $out .= $key ."=". urlencode(trim($val)) ."&";
    }
    $str = substr($out, 0, -1) . "&passphrase=" . urlencode(trim($pass));
    echo md5($str);
  `], { encoding: 'utf8' });
  if (php.status !== 0) return;
  assert.equal(php.stdout.trim(), signPairs(documented, 'jt7NOE43FZPn'));
});

test('PayFast amount parsing stays in integer cents', () => {
  assert.equal(parseAmountToCents('950.00'), 95000);
  assert.equal(parseAmountToCents('950'), 95000);
  assert.equal(parseAmountToCents('950.5'), 95050);
  assert.equal(parseAmountToCents('950.001'), null);
  assert.equal(parseAmountToCents('9,50'), null);
});

test('published PayFast IP ranges include the edges and exclude the neighbours', () => {
  assert.equal(ipInPayfastRanges('197.97.145.144'), true);
  assert.equal(ipInPayfastRanges('197.97.145.159'), true);
  assert.equal(ipInPayfastRanges('197.97.145.160'), false);
  assert.equal(ipInPayfastRanges('197.97.145.143'), false);
  assert.equal(ipInPayfastRanges('41.74.179.192'), true);
  assert.equal(ipInPayfastRanges('41.74.179.223'), true);
  assert.equal(ipInPayfastRanges('41.74.179.224'), false);
  assert.equal(ipInPayfastRanges('102.216.36.0'), true);
  assert.equal(ipInPayfastRanges('102.216.36.15'), true);
  assert.equal(ipInPayfastRanges('102.216.36.16'), false);
  assert.equal(ipInPayfastRanges('102.216.36.128'), true);
  assert.equal(ipInPayfastRanges('102.216.36.143'), true);
  assert.equal(ipInPayfastRanges('144.126.193.139'), true);
  assert.equal(ipInPayfastRanges('144.126.193.140'), false);
  assert.equal(ipInPayfastRanges('::ffff:197.97.145.150'), true);
  assert.equal(ipInPayfastRanges('127.0.0.1'), false);
  assert.equal(ipInPayfastRanges('1.2.3.4'), false);
  assert.equal(ipInCidr('10.0.0.1', '10.0.0.0', 8), true);
});
