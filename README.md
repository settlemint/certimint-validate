# A toolkit to independently verify CertiMint seals

This npm package allows you to independently verify a CertiMint blockchain seal.

## Installation

```sh
npm install --save @settlemint/certimint-validate
```

## Usage

```typescript

    import { CertiMintValidation } from '@settlemint/certimint-validate';

    const certiMintValidation = new CertiMintValidation();
    isValid = await certiMintValidation.validateSeal(
      document.seal,
      'https://mainnet.infura.io'
    );
```
