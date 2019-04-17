# A toolkit to independently verify CertiMint seals

This npm package allows you to independently verify a CertiMint blockchain seal.

## Installation

```sh
npm install --save @settlemint/certimint-validate
```

## Usage

```typescript
import { CertiMintValidation } from '@settlemint/certimint-validate';

const certiMintValidation = new CertiMintValidation(
  protocol, // required: ethereum || bitcoin
  bitcoinApiKey // optional: apikey for blockcypher, if not provided you will be limited to blockcypher's free tier request limit https://www.blockcypher.com/dev/bitcoin/#rate-limits-and-tokens
);
isValid = await certiMintValidation.validateSeal(
  mySealObject,
  'https://mainnet.infura.io'// or https://api.blockcypher.com/v1/btc/main for the bitcoin mainnet
);
```
