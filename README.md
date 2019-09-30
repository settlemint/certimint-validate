# A toolkit to independently verify CertiMint seals

This npm package allows you to independently verify a CertiMint blockchain seal.

## Installation

```sh
npm install --save @settlemint/certimint-validate
```

## Usage

```typescript
import { CertiMintValidation } from '@settlemint/certimint-validate';

const bitcoinApiKey = 'e341cb773bff270e539690b93fb69f32'; // Optional, your api key from blockcypher if you use bitcoin anchors

const certiMintValidation = new CertiMintValidation(bitcoinApiKey);

const options = {
  bitcoinUrl: 'https://api.blockcypher.com/v1/btc/main', // Optional; Api url for bitcoin
};
status = await certiMintValidation.validateSeal(mySealObject, options);

status === SealStatus.CONFIRMED; // Seal has successfully been anchored
status === SealStatus.FAILED; // Failed to anchor seal, signinvites and/or signatures
status === SealStatus.PENDING; // Waiting for seal, signinvites and/or signatures to be anchored
```
