/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "api.qrserver.com",
			},
		],
	},
	onDemandEntries: {
		maxInactiveAge: 1000 * 60 * 60,
		pagesBufferLength: 100,
	},
};

export default nextConfig;
