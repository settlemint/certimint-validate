import { InfuraProvider } from '@ethersproject/providers';
import MerkleTools from '@settlemint/merkle-tools';
import Axios from 'axios';
import { sha3_512 } from 'js-sha3';
import { Readable } from 'stream';

export enum Protocol {
  BITCOIN = 'bitcoin',
  ETHEREUM = 'ethereum',
}

export enum NetworkName {
  MAINNET = 'mainnet',
  TESTNET = 'testnet',
}

export enum DataType {
  STRING = 'STRING',
  FILE = 'FILE',
  HASH = 'HASH',
}

export enum SealStatus {
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  PENDING = 'pending',
}

export interface ISeal {
  id: string;
  dataHash: string;
  anchors: IAnchors<IAnchor>;
  signatures?: ISignatures;
  signinvites?: ISignInvites;
  sealed: string;
}

export interface IAnchor {
  transactionId: string;
  nodeUrl: string;
  explorer: string;
  merkleRoot: string;
  proof: IProof[];
  exists?: boolean;
}

export interface IInviteAnchor extends IAnchor {
  invites?: { [inviteId: string]: ISignInvite };
  transactionStatus: SealStatus;
}

export interface ISignInvite {
  proof: IProof[];
  hash: string;
}

export interface IAnchors<Type> {
  ethereum?: {
    [networkId: string]: Type;
  };
  bitcoin?: {
    mainnet?: Type;
    testnet?: Type;
  };
}

export interface IProof {
  right?: string;
  left?: string;
}

export interface ISignatures {
  ethereum?: {
    [signerAddress: string]: {
      transactionId: string;
      nodeUrl: string;
      explorer: string;
      signature: string;
      signed: string;
      transactionStatus: SealStatus;
    };
  };
}

export interface IConfig {
  bitcoin?: {
    url?: string;
    apiKey?: string;
  };

  ethereum?: {
    apiKey?: string;
  };
}

export interface ISignInvites {
  anchors: IAnchors<IInviteAnchor>;
}
export class CertiMintValidation {
  public constructor(protected config: IConfig = {}) {}

  public async updateSeal(seal: ISeal): Promise<ISeal> {
    seal.signatures = await this.resolveSignatures(seal.signatures);
    if (seal.signinvites) {
      seal.signinvites = await this.resolveSignInvites(seal.signinvites);
    }

    return seal;
  }

  public async validateSealAndData(
    seal: ISeal,
    data: string,
    dataType: DataType
  ): Promise<SealStatus> {
    const hash = await this.hashForData(data, dataType);

    const validationStatus = await this.validateSeal(seal);

    return hash.toLowerCase() === seal.dataHash.toLowerCase() ? validationStatus : SealStatus.FAILED;
  }

  public async validateSeal(seal: ISeal): Promise<SealStatus> {
    const validAnchors = await this.validateAnchors(
      seal.anchors,
      seal.dataHash
    );

    const validSignatures = seal.signatures
      ? await this.validateSignatures(seal.signatures)
      : SealStatus.CONFIRMED;
    const validSignInvites = seal.signinvites
      ? await this.validateSignInvites(seal.signinvites)
      : SealStatus.CONFIRMED;

    if (
      validSignatures === SealStatus.FAILED ||
      validSignInvites === SealStatus.FAILED ||
      !validAnchors
    ) {
      return SealStatus.FAILED;
    }

    if (
      validSignatures === SealStatus.PENDING ||
      validSignInvites === SealStatus.PENDING
    ) {
      return SealStatus.PENDING;
    }

    return SealStatus.CONFIRMED;
  }

  private async hashForData(
    data: string | Readable | Blob,
    dataType: DataType
  ) {
    let hex: string;
    switch (dataType) {
      case DataType.FILE:
        if (data instanceof Readable) {
          hex = await this.streamToHashForNode(data);
        } else if (data instanceof Blob) {
          hex = await this.streamToHashForBrowser(data);
        } else {
          throw new Error(
            `ERROR: File is not Readable or Blob for ${dataType}`
          );
        }
        break;
      case DataType.STRING:
        if (data instanceof Readable || data instanceof Blob) {
          throw new Error(
            `ERROR: Data cannot be Readable or Blob for ${dataType}`
          );
        }
        hex = sha3_512(data);
        break;
      case DataType.HASH:
        if (data instanceof Readable || data instanceof Blob) {
          throw new Error(
            `ERROR: Data cannot be Readable or Blob for ${dataType}`
          );
        }
        hex = data;
        break;
      default:
        throw new Error(`ERROR: unknown type ${dataType}`);
    }

    return hex;
  }

  private async validateAnchors(
    anchors: IAnchors<IAnchor>,
    dataHash: string
  ): Promise<boolean> {
    let isValid = true;
    for (const protocol of Object.keys(anchors)) {
      switch (protocol) {
        case Protocol.ETHEREUM:
          isValid =
            isValid && (await this.validateEthereumAnchor(anchors, dataHash));
          break;
        case Protocol.BITCOIN:
          isValid =
            isValid && (await this.validateBitcoinAnchor(anchors, dataHash));
          break;

        default:
          throw new Error(`Unsupported protocol ${protocol}`);
      }
    }

    return isValid;
  }

  private async validateEthereumAnchor(
    anchors: IAnchors<IAnchor>,
    dataHash: string
  ) {
    let isValid = true;

    for (const chainId of Object.keys(anchors[Protocol.ETHEREUM] || [])) {
      const anchor = anchors[Protocol.ETHEREUM]?.[chainId];
      if (anchor) {

        if(anchor.nodeUrl.match(/mintnet/)){
          // the mintnet network is discontinued.
          // since all anchors are also on the mainnet and bitcoin, no security is lost.
          return true;
        }

        const provider = InfuraProvider.getWebSocketProvider('homestead', this.config.ethereum.apiKey);

        console.log(`Trying to validate ${this.addHexPrefix(anchor.transactionId)} on Infura`);
        const tx = await provider.getTransaction(
          this.addHexPrefix(anchor.transactionId)
        );

        if(!tx){
          console.log(`Not found:`, anchor)

          return false;
        }

        anchor.exists = tx.data === this.addHexPrefix(anchor.merkleRoot);

        const merkleTools = new MerkleTools({
          hashType: 'SHA3-512',
        });

        const validProof = merkleTools.validateProof(
          anchor.proof,
          dataHash,
          anchor.merkleRoot
        );

        isValid = isValid && anchor.exists && validProof;
      }
    }

    return isValid;
  }

  private async validateBitcoinAnchor(
    anchors: IAnchors<IAnchor>,
    dataHash: string
  ) {
    let isValid = true;
    for (const networkName of Object.keys(anchors[Protocol.BITCOIN] || [])) {
      const anchor = anchors[Protocol.BITCOIN]?.[networkName];
      if (anchor) {
        try {
          const txId = anchor.transactionId;
          const tx = await Axios.get(
            this.buildTxUrl(
              this.config?.bitcoin?.url ||
                'https://api.blockcypher.com/v1/btc/main',
              txId
            )
          );

          const txOutputs = tx.data.outputs;
          let merkleRoot: string | null = null;
          for (const output of txOutputs) {
            if (output.data_hex !== undefined && output.data_hex !== null) {
              merkleRoot = output.data_hex;
            }
          }

          if (!merkleRoot) {
            throw new Error('Merkle root is undefined');
          }

          anchor.exists = merkleRoot === anchor.merkleRoot;

          const merkleTools = new MerkleTools({
            hashType: 'SHA3-512',
          });

          const validProof = merkleTools.validateProof(
            anchor.proof,
            dataHash,
            anchor.merkleRoot
          );

          isValid = isValid && anchor.exists && validProof;
        } catch (error) {
          if (error.response !== undefined && error.response.status === 429) {
            throw new Error(
              'Too many request to the blockcypher api, please add an apikey or upgrade your blockcypher plan'
            );
            // tslint:disable-next-line: unnecessary-else
          } else {
            throw error;
          }
        }
      }
    }

    return isValid;
  }

  private async validateSignatures(
    signatures: ISignatures
  ): Promise<SealStatus> {
    let isValid = SealStatus.CONFIRMED;
    for (const protocol of Object.keys(signatures)) {
      for (const address of Object.keys(signatures[protocol])) {
        // This should technically not be neccessary since we only anchor signatures on Ethereum
        if (protocol === Protocol.ETHEREUM) {
          const signature = signatures[protocol]?.[address];
          if (signature) {
            const signatureProvider = InfuraProvider.getWebSocketProvider('homestead', this.config.ethereum.apiKey);

            const tx = await signatureProvider.getTransaction(
              this.addHexPrefix(signature.transactionId)
            );
            if (tx) {
              if (tx.data === this.addHexPrefix(signature.signature)) {
                isValid =
                  isValid === SealStatus.CONFIRMED
                    ? SealStatus.CONFIRMED
                    : isValid;
              } else {
                return SealStatus.FAILED;
              }
            }
            if (
              !tx &&
              signature.transactionStatus &&
              signature.transactionStatus === SealStatus.PENDING
            ) {
              isValid = SealStatus.PENDING;
            }

            if (
              !tx &&
              (!signature.transactionStatus ||
                signature.transactionStatus !== SealStatus.PENDING)
            ) {
              return SealStatus.FAILED;
            }
          }
        }
      }
    }

    return isValid;
  }

  private async validateSignInvites(
    signInvites: ISignInvites
  ): Promise<SealStatus> {
    let isValid = SealStatus.CONFIRMED;

    if (signInvites && signInvites.anchors) {
      const signInviteAnchors = signInvites.anchors;
      for (const protocol of Object.keys(signInviteAnchors)) {
        for (const chainId of Object.keys(signInviteAnchors[protocol])) {
          // This should technically not be neccessary since we only anchor signinvites on Ethereum
          if (protocol === Protocol.ETHEREUM) {
            const signInvite = signInviteAnchors[protocol]?.[chainId];
            if (signInvite) {
              const signInviteProvider = InfuraProvider.getWebSocketProvider('homestead', this.config.ethereum.apiKey);

              const tx = await signInviteProvider.getTransaction(
                this.addHexPrefix(signInvite.transactionId)
              );

              if (tx) {
                signInvite.exists =
                  tx.data === this.addHexPrefix(signInvite.merkleRoot);
                isValid =
                  isValid === SealStatus.CONFIRMED
                    ? SealStatus.CONFIRMED
                    : isValid;

                const merkleTools = new MerkleTools({
                  hashType: 'SHA3-512',
                });
                let validProof = true;

                for (const inviteId of Object.keys(signInvite.invites || {})) {
                  const inviteAnchor = signInvite.invites?.[inviteId];

                  if (inviteAnchor) {
                    validProof = merkleTools.validateProof(
                      inviteAnchor.proof,
                      inviteAnchor.hash,
                      signInvite.merkleRoot
                    );
                  }
                }

                if (!validProof || !signInvite.exists) {
                  return SealStatus.FAILED;
                }
              }
              if (
                !tx &&
                signInvite.transactionStatus &&
                signInvite.transactionStatus === SealStatus.PENDING
              ) {
                isValid = SealStatus.PENDING;
              }

              if (
                !tx &&
                (!signInvite.transactionStatus ||
                  signInvite.transactionStatus !== SealStatus.PENDING)
              ) {
                return SealStatus.FAILED;
              }
            }
          }
        }
      }
    }

    return isValid;
  }

  private async resolveSignatures(
    signatures?: ISignatures
  ): Promise<ISignatures | undefined> {
    if (signatures) {
      for (const protocol of Object.keys(signatures || [])) {
        for (const address of Object.keys(signatures?.[protocol] || [])) {
          // This should technically not be neccessary since we only anchor signatures on Ethereum
          if (protocol === Protocol.ETHEREUM) {
            const signature = signatures?.[protocol]?.[address];
            if (signature) {
              const signatureProvider = InfuraProvider.getWebSocketProvider('homestead', this.config.ethereum.apiKey);

              const tx = await signatureProvider.getTransaction(
                this.addHexPrefix(signature.transactionId)
              );
              if (tx) {
                if (tx.data === this.addHexPrefix(signature.signature)) {
                  // tslint:disable-next-line: ban-ts-ignore
                  // @ts-ignore
                  signatures[protocol][address].transactionStatus =
                    SealStatus.CONFIRMED;
                }
              }
            }
          }
        }
      }
    }

    return signatures;
  }

  private async resolveSignInvites(
    signInvites: ISignInvites
  ): Promise<ISignInvites> {
    if (signInvites && signInvites.anchors) {
      const signInviteAnchors = signInvites.anchors;
      for (const protocol of Object.keys(signInviteAnchors)) {
        for (const chainId of Object.keys(signInviteAnchors[protocol])) {
          // This should technically not be neccessary since we only anchor signinvites on Ethereum
          if (protocol === Protocol.ETHEREUM) {
            const signInvite = signInviteAnchors[protocol]?.[chainId];
            if (signInvite) {
              const signInviteProvider = InfuraProvider.getWebSocketProvider('homestead', this.config.ethereum.apiKey);

              const tx = await signInviteProvider.getTransaction(
                this.addHexPrefix(signInvite.transactionId)
              );

              if (
                tx &&
                tx.data === this.addHexPrefix(signInvite.merkleRoot) &&
                signInviteAnchors[protocol]
              ) {
                // tslint:disable-next-line: ban-ts-ignore
                // @ts-ignore
                signInviteAnchors[protocol][chainId].transactionStatus =
                  SealStatus.CONFIRMED;
              }
            }
          }
        }
      }
    }

    return signInvites;
  }

  private addHexPrefix(fromValue: string) {
    return this.isHexPrefixed(fromValue) ? fromValue : '0x' + fromValue;
  }

  private isHexPrefixed(valueToCheck: string) {
    return valueToCheck.substring(0, 2) === '0x';
  }

  private async streamToHashForNode(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const allData: Buffer[] = [];
      stream.on('data', (chunk) => {
        allData.push(chunk);
      });
      stream.on('end', () => {
        resolve(sha3_512(Buffer.concat(allData)));
      });
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async streamToHashForBrowser(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(sha3_512(reader.result as ArrayBuffer));
      };
      reader.onerror = () => {
        reject('Could not read file');
      };
      reader.readAsArrayBuffer(file);
    });
  }

  private buildTxUrl(baseUrl: string, txId: string) {
    const apiKeyParam = this.config?.bitcoin?.apiKey
      ? `?token=${this.config.bitcoin.apiKey}`
      : '';

    return `${baseUrl}/txs/${txId}${apiKeyParam}`;
  }

  private addInfuraApiKey(baseUrl: string) {
    return baseUrl.match(/infura.io/) && this.config?.ethereum?.apiKey
      ? baseUrl.replace(
          /infura.io/,
          `infura.io/v3/${this.config.ethereum.apiKey}`
        )
      : baseUrl;
  }
}
