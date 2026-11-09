cask "term-lab" do
  version "0.4.0" # x-release-please-version
  sha256 "6ee6534e4d177c3da09588e72a77d77be9077105e2e1f35d998303a8d8c2f9b3"

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
