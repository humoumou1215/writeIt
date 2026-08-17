// 提交图（commit graph，M15）：git log --graph 的简化前端实现
//  输入：按主线上最新→最旧排序的提交（含 parents）
//  输出：每提交一行的字符数组行（等宽字体渲染：o=提交 / +=合并 / |=垂直延续 / \、/=分叉/汇聚）
//  算法（lane 分配）：
//    lanes[j] = 第 j 列"向下延伸的线"的下一个目标提交 hash（即从上方某提交画下来的线的终点，未来某行到达）
//    每处理一个提交 c：
//      1. pos = lanes 中 c.hash 的位置（该列线到达 c，画节点）；不存在则新开一列
//      2. 其余列：指向 c.hash 的列 → 汇聚线（/ 或 \ 指向节点）；指向 c.parents 的列 → 竖线（未来到达父）
//         其他 → 竖线
//      3. 更新：本列延伸为主父提交（或无父则终止）；merge 的非主父挂新列（已在 lanes 则复用）；
//         其它指向 c.hash 的列终止（消费）
export type GraphRow = string[]

export interface GraphCommit {
  hash: string
  parents: string[]
}

export function buildGraph(commits: GraphCommit[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const rows: GraphRow[] = []

  for (const c of commits) {
    let pos = lanes.indexOf(c.hash)
    if (pos === -1) {
      lanes.push(c.hash)
      pos = lanes.length - 1
    }

    const row: string[] = new Array(lanes.length).fill(' ')
    for (let j = 0; j < lanes.length; j++) {
      const cur = lanes[j]
      if (cur === null) continue
      if (j === pos) {
        row[j] = c.parents.length > 1 ? '+' : 'o'
      } else if (cur === c.hash) {
        // 另一条线的终点就是当前提交 → 该线本行到达，汇入节点
        row[j] = j < pos ? '/' : '\\'
      } else {
        row[j] = '|'
      }
    }

    // 更新 lanes
    lanes[pos] = c.parents[0] ?? null
    // merge：非主父挂新列（已在 lanes 则复用该线，避免重复挂载）
    for (let k = 1; k < c.parents.length; k++) {
      if (!lanes.includes(c.parents[k])) lanes.push(c.parents[k])
    }
    // 消费其它指向当前提交的线
    for (let j = 0; j < lanes.length; j++) {
      if (j !== pos && lanes[j] === c.hash) lanes[j] = null
    }
    // 修剪尾部死列（行宽收缩）
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    rows.push(row)
  }
  return rows
}