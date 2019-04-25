# A toolkit to independently verify CertiMint seals

This npm package allows you to independently verify a CertiMint blockchain seal.

## Installation

```sh
npm install --save @settlemint/certimint-validate
```

## Usage

```typescript
import { CertiMintValidation } from '@settlemint/certimint-validate';

const bitcoinApiKey = 'e341cb773bff270e539690b93fb69f32'; // optional, your api key from blockcypher

const certiMintValidation = new CertiMintValidation(bitcoinApiKey);
isValid = await certiMintValidation.validateSeal(
  mySealObject,
  'https://mainnet.infura.io', // api url for ethereum
  'https://api.blockcypher.com/v1/btc/main' // api url for bitcoin
);
```
