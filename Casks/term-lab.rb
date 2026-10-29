cask "term-lab" do
  version "0.2.0" # x-release-please-version
  sha256 "a6b61f89c77cabdb8d904cd01d1f4082be540484e66be4589060425488759c19"

  url "https://github.com/matheusmntt/term-lab/releases/download/v#{version}/Term.Lab_#{version}_universal.dmg"
  name "Term Lab"
  desc "Desktop terminal that centralizes sessions with tiling panes and project groups"
  homepage "https://termlab.matheusmonteiro.me"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :ventura"

  app "Term Lab.app"

  zap trash: [
    "~/Library/Application Support/me.matheusmonteiro.termlab",
    "~/Library/Caches/me.matheusmonteiro.termlab",
    "~/Library/Preferences/me.matheusmonteiro.termlab.plist",
    "~/Library/Saved Application State/me.matheusmonteiro.termlab.savedState",
    "~/Library/WebKit/me.matheusmonteiro.termlab",
  ]
end
