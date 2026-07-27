const record = (value, label) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value;
};

export function validateEtherscanBlockNumber(value) {
  const body = record(value, "Etherscan response");
  if (body.error || body.status === "0") {
    throw new Error(`Etherscan returned an API error: ${JSON.stringify(body.error ?? body)}`);
  }
  if (typeof body.result !== "string" || !/^0x[0-9a-f]+$/i.test(body.result)) {
    throw new TypeError("Etherscan response has an invalid block-number result");
  }
  return body.result;
}

export function validateBlockscoutStats(value) {
  const body = record(value, "Blockscout stats");
  const integer = (field) => {
    const raw = body[field];
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
      throw new TypeError(`Blockscout stats has invalid ${field}`);
    }
    return BigInt(raw);
  };
  return {
    totalBlocks: integer("total_blocks"),
    totalTransactions: integer("total_transactions"),
    totalAddresses: integer("total_addresses"),
  };
}
