// 逐步定位
const r1 = /^<mark\s+data-note=(['"])((?:(?!\1).)*)\1\s*>$/i
console.log('r1 simple:', r1.test(`<mark data-note='x'>`))
const r2 = /^<mark\s+data-note=(['"])((?:[^'"]*))\1\s*>$/i
console.log('r2 simple:', r2.test(`<mark data-note='x'>`))
const r3 = /^<mark\s+data-note=(['"])(.*)\1\s*>$/i
console.log('r3 simple:', r3.test(`<mark data-note='x'>`))
const r4 = /^<mark\s+data-note=(['"])[^'"]*\1\s*>$/i
console.log('r4 simple:', r4.test(`<mark data-note='x'>`))
// 测试 \1 在负向前瞻中
const r5 = /(['"])((?:(?!\1).)*)\1/
console.log('r5 json:', r5.test(`'[{"a":"我"}]'`))
console.log('r5 simple:', r5.test(`'x'`))
