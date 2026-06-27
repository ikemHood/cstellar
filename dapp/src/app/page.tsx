import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="text-center py-16">
        <h1 className="text-5xl font-bold mb-4">
          Stellar Confidential Transfer Standard
        </h1>
        <p className="text-xl text-stellar-blue max-w-2xl mx-auto mb-8">
          SCT-01 is a developer standard and kit for adding private transfers
          to Stellar apps without rebuilding the ZK stack.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/wrap" className="btn-primary">
            Get Started
          </Link>
          <Link href="/explorer" className="btn-secondary">
            View Explorer
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="grid md:grid-cols-3 gap-8">
        <div className="card text-center">
          <div className="text-4xl mb-4">1</div>
          <h3 className="text-xl font-semibold mb-2">Deposit</h3>
          <p className="text-stellar-blue">
            Deposit public XLM into the Confidential Transfer Adapter.
            Receive a private note commitment.
          </p>
        </div>
        <div className="card text-center">
          <div className="text-4xl mb-4">2</div>
          <h3 className="text-xl font-semibold mb-2">Transfer</h3>
          <p className="text-stellar-blue">
            Send confidential tokens privately. The transfer amount is hidden
            from the public chain using ZK proofs.
          </p>
        </div>
        <div className="card text-center">
          <div className="text-4xl mb-4">3</div>
          <h3 className="text-xl font-semibold mb-2">Withdraw</h3>
          <p className="text-stellar-blue">
            Convert confidential tokens back to the original public asset.
            Recipient receives the real token.
          </p>
        </div>
      </section>

      {/* What's hidden vs public */}
      <section className="grid md:grid-cols-2 gap-8">
        <div className="card">
          <h3 className="text-xl font-semibold mb-4 text-green-400">
            Hidden from public chain
          </h3>
          <ul className="space-y-2 text-stellar-blue">
            <li>Transfer amounts</li>
            <li>Confidential balances</li>
            <li>Internal transfer history</li>
            <li>Recipient amounts</li>
            <li>Change amounts</li>
          </ul>
        </div>
        <div className="card">
          <h3 className="text-xl font-semibold mb-4 text-yellow-400">
            Visible on public chain
          </h3>
          <ul className="space-y-2 text-stellar-blue">
            <li>Adapter contract address</li>
            <li>Transaction submitter</li>
            <li>Deposit/withdraw amounts (entry/exit)</li>
            <li>Commitments and nullifiers</li>
            <li>Token type being used</li>
          </ul>
        </div>
      </section>

      {/* Architecture */}
      <section className="card">
        <h3 className="text-xl font-semibold mb-4">Architecture</h3>
        <div className="grid md:grid-cols-4 gap-4 text-center text-sm">
          <div className="bg-stellar-blue/20 rounded-lg p-4">
            <div className="font-semibold mb-1">Circom Circuit</div>
            <div className="text-stellar-blue">
              ZK proofs for transfer & withdraw validation
            </div>
          </div>
          <div className="bg-stellar-blue/20 rounded-lg p-4">
            <div className="font-semibold mb-1">Verifier Contract</div>
            <div className="text-stellar-blue">
              On-chain Groth16 proof verification
            </div>
          </div>
          <div className="bg-stellar-blue/20 rounded-lg p-4">
            <div className="font-semibold mb-1">Transfer Adapter</div>
            <div className="text-stellar-blue">
              Commitments, nullifiers, vault
            </div>
          </div>
          <div className="bg-stellar-blue/20 rounded-lg p-4">
            <div className="font-semibold mb-1">SCT Kit + dApp</div>
            <div className="text-stellar-blue">
              Note management, encryption, UX
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
