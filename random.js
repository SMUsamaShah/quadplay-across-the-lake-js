// Quadplay's deterministic default stream, using the xorshift128+ algorithm
// by Andreas Madsen and Emil Bay. See LICENSE.md for the MIT notice.
export function createLakeRandom() {
  const seed = new DataView(new ArrayBuffer(8));
  seed.setFloat64(0, 4.7499362e13, true);
  const low = seed.getUint32(0, true);
  const high = seed.getUint32(4, true);
  let first = (BigInt((low & 0xffff) || 5662365) << 32n) | BigInt(low >>> 16);
  let second = (BigInt(high & 0xffff) << 32n) | BigInt(high >>> 16);

  function random(min = 0, max = 1) {
    const sum = BigInt.asUintN(64, first + second);
    const shifted = first ^ BigInt.asUintN(64, first << 23n);
    first = second;
    second = shifted ^ first ^ (shifted >> 18n) ^ (first >> 5n);
    return min + Number(sum >> 12n) * 2 ** -52 * (max - min);
  }

  // Match the original generator warm-up and the draws consumed by the
  // console's invisible sprite warm-up before game initialization.
  for (let i = 0; i < 300 + 150 * 33; i++) random();
  return random;
}
