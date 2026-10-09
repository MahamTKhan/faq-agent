/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors are reported by `npm run typecheck` (and the GitHub Actions check),
  // so a stray type nit never blocks a deploy.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["mailparser", "nodemailer", "mammoth", "@kenjiuno/msgreader", "postgres"],
};

export default nextConfig;
