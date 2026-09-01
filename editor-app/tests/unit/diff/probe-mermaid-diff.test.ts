import { it, expect } from 'vitest'
import { diffMermaid } from '../../../src/editor/mermaid-diff'

const OLD = `flowchart TD
  subgraph 贷前
    A[接收进件] --> B{黑名单}
    B -->|命中| X[拒绝]
    B -->|未命中| C[额度评估]
    C --> D[(资金方池)]
  end
  subgraph 贷中
    D -->|额度充足| E[放款处理]
    D -->|额度不足| F[人工复核]
    E --> G([完成])
    F --> H[/补件通知\\]
  end`

const NEW = `flowchart TD
  subgraph 贷前
    A[接收进件] --> B{黑名单}
    B -->|命中| X[直接拒绝]
    B -->|未命中| C[额度评估]
    B -->|白名单| I[秒批通道]
    C --> D[(资金方池)]
  end
  subgraph 贷中
    D -->|额度充足| E[放款处理]
    D -->|额度不足| F[人工复核转人工]
    E --> G([完成])
  end
  subgraph 贷后
    E --> J[贷后监控]
    J --> K[逾期预警]
  end`

it('probe diffMermaid merged output', () => {
  const d = diffMermaid(OLD, NEW)
  console.log('=== type:', d.type, 'confidence:', d.confidence)
  console.log('=== add:', JSON.stringify(d.add))
  console.log('=== del:', JSON.stringify(d.del))
  console.log('=== mod:', JSON.stringify(d.mod))
  console.log('=== merged ===')
  console.log(d.merged)
  console.log('=== /merged ===')
  expect(d.type).toBe('flowchart')
})
