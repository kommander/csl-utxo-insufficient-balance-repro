import CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { generateMnemonic, mnemonicToEntropy } from 'bip39';

const harden = (num: number): number => {
  return 0x80000000 + num;
};

const protocolParameters = {
  min_fee_a: 44,
  min_fee_b: 155381,
  pool_deposit: '500000000',
  key_deposit: '2000000',
  max_val_size: '5000',
  max_tx_size: 16384,
  coins_per_utxo_size: '4310',
};

const txBuilder = CardanoWasm.TransactionBuilder.new(
CardanoWasm.TransactionBuilderConfigBuilder.new()
  .fee_algo(
  CardanoWasm.LinearFee.new(
    CardanoWasm.BigNum.from_str(protocolParameters.min_fee_a.toString()),
    CardanoWasm.BigNum.from_str(protocolParameters.min_fee_b.toString()),
  ),
  )
  .pool_deposit(CardanoWasm.BigNum.from_str(protocolParameters.pool_deposit))
  .key_deposit(CardanoWasm.BigNum.from_str(protocolParameters.key_deposit))
  .coins_per_utxo_byte(
  CardanoWasm.BigNum.from_str(protocolParameters.coins_per_utxo_size || '4310'),
  )
  .max_value_size(parseInt(protocolParameters.max_val_size ?? '5000', 10))
  .max_tx_size(protocolParameters.max_tx_size)
  .build(),
);

const mnemonic = generateMnemonic(256);
const entropy = mnemonicToEntropy(mnemonic);

const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
  Buffer.from(entropy, 'hex'), Uint8Array.from([0])
);

const networkId = CardanoWasm.NetworkInfo.testnet().network_id()
const accountIndex = 0;
const addressIndex = 1;

const accountKey = rootKey
  .derive(harden(1852)) // purpose
  .derive(harden(1815)) // coin type
  .derive(harden(accountIndex)); // account #

const utxoKey = accountKey
  .derive(1) // external
  .derive(addressIndex);

const stakeKey = accountKey
  .derive(2) // chimeric
  .derive(0)
  .to_public();

const baseAddress = CardanoWasm.BaseAddress.new(
  networkId,
  CardanoWasm.StakeCredential.from_keyhash(
    utxoKey.to_public().to_raw_key().hash(),
  ),
  CardanoWasm.StakeCredential.from_keyhash(stakeKey.to_raw_key().hash()),
);

const address = baseAddress.to_address().to_bech32();

const signKey = utxoKey.to_raw_key()

const changeAddr = CardanoWasm.Address.from_bech32(address);
const outputAddr = changeAddr;

const policyPrivateKey = CardanoWasm.PrivateKey.generate_ed25519()
const policyPubKey = policyPrivateKey.to_public();
const policyAddr = CardanoWasm.BaseAddress.new(
  CardanoWasm.NetworkInfo.testnet().network_id(),
  CardanoWasm.StakeCredential.from_keyhash(policyPubKey.hash()),
  CardanoWasm.StakeCredential.from_keyhash(policyPubKey.hash())
).to_address();

const paymentCredentialHash = CardanoWasm.BaseAddress.from_address(policyAddr)
  ?.payment_cred()
  .to_keyhash();

const nativeScripts = CardanoWasm.NativeScripts.new()
const sigScript = CardanoWasm.NativeScript.new_script_pubkey(CardanoWasm.ScriptPubkey.new(paymentCredentialHash!))
nativeScripts.add(sigScript)
const allScript = CardanoWasm.NativeScript.new_script_all(CardanoWasm.ScriptAll.new(nativeScripts))
const policyId = allScript.hash().to_hex();

const mintAsset = {
  assetName: 'TestAsset',
  quantity: 1000000,
}

const encodedAssetName = new TextEncoder().encode(mintAsset.assetName);
const cardanoAssetName = CardanoWasm.AssetName.new(encodedAssetName);

//
// ---
//

const mintBuilder = CardanoWasm.MintBuilder.new();
const mintWitness = CardanoWasm.MintWitness.new_native_script(allScript);
mintBuilder.add_asset(
  mintWitness,
  cardanoAssetName,
  CardanoWasm.Int.from_str(mintAsset.quantity.toString()),
)
mintBuilder.build();
txBuilder.set_mint_builder(mintBuilder);

const multiAsset = CardanoWasm.MultiAsset.from_json('{"' + policyId + '":{"' + cardanoAssetName.to_hex() + '":"' + mintAsset.quantity + '"}}');
const txoBuilder = CardanoWasm.TransactionOutputBuilder.new();
const dataCost = CardanoWasm.DataCost.new_coins_per_byte(CardanoWasm.BigNum.from_str(protocolParameters.coins_per_utxo_size || '4310'));
const txo = txoBuilder.with_address(outputAddr).next().with_asset_and_min_required_coin_by_utxo_cost(multiAsset, dataCost).build();

txBuilder.add_output(
  CardanoWasm.TransactionOutput.new(
    outputAddr,
    CardanoWasm.Value.new_with_assets(txo.amount().coin(), multiAsset)
  ),
);

//
// ---
//

const value = CardanoWasm.Value.new(
  CardanoWasm.BigNum.from_str('1000000000'),
);

const output = CardanoWasm.TransactionOutput.new(changeAddr, value);

const input = CardanoWasm.TransactionInput.new(
  CardanoWasm.TransactionHash.from_bytes(Buffer.from('c27120f08825c5e2091d98c2648de136b4bb4d488ae07c034097be3bd4825c60', 'hex')),
  1,
);

const unspentOutputs = CardanoWasm.TransactionUnspentOutputs.new();
unspentOutputs.add(CardanoWasm.TransactionUnspentOutput.new(input, output));

txBuilder.add_inputs_from(
  unspentOutputs,
  CardanoWasm.CoinSelectionStrategyCIP2.LargestFirstMultiAsset,
);

txBuilder.add_change_if_needed(changeAddr);

const tx = txBuilder.build_tx();
const txBody = tx.body();
const txHash = Buffer.from(
  CardanoWasm.hash_transaction(txBody).to_bytes(),
).toString('hex');

console.log('txHash', txHash);