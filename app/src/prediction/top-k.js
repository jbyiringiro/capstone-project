// Ranking shared by every predictor: probability descending, then symbol key ascending, the same
// order as Python's sort key (-p, symbol) so browser and server suggestions agree on ties.
export const ranksBefore = ([keyA, pA], [keyB, pB]) => pA > pB || (pA === pB && keyA < keyB)

// The k best entries of a distribution in O(n log k) with a bounded heap, instead of sorting all n
// scores. heap[0] is always the weakest entry kept, so a new entry only has to beat that one.
export function topK(distribution, k, exclude = null) {
  const heap = []
  if (k <= 0) return heap
  for (const entry of Object.entries(distribution)) {
    if (entry[0] === exclude) continue
    if (heap.length < k) {
      heap.push(entry)
      siftUp(heap, heap.length - 1)
    } else if (ranksBefore(entry, heap[0])) {
      heap[0] = entry
      siftDown(heap, 0)
    }
  }
  return heap.sort((a, b) => (ranksBefore(a, b) ? -1 : 1)).map(([key]) => key)
}

function siftUp(heap, index) {
  while (index > 0) {
    const parent = (index - 1) >> 1
    if (!ranksBefore(heap[parent], heap[index])) return
    ;[heap[parent], heap[index]] = [heap[index], heap[parent]]
    index = parent
  }
}

function siftDown(heap, index) {
  for (;;) {
    let weakest = index
    for (const child of [2 * index + 1, 2 * index + 2]) {
      if (child < heap.length && ranksBefore(heap[weakest], heap[child])) weakest = child
    }
    if (weakest === index) return
    ;[heap[weakest], heap[index]] = [heap[index], heap[weakest]]
    index = weakest
  }
}
