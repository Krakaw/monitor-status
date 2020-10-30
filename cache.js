const CACHE_EXPIRY = (process.env.CACHE_EXPIRY || 5) * 60 * 1000;
const cache = {
	get(key, ignoreExpiry) {
		this._check(key);
		if ((new Date()) - this.data[key].time < CACHE_EXPIRY || ignoreExpiry) {
			return this.data[key].value;
		}
		return false;
	},
	set(key, value) {
		this.data[key] = {
			time: new Date(),
			value
		}
	},
	_check(key) {
		if (!this.data.hasOwnProperty(key)) {
			this.data[key] = {
				time: 0,
				value: false
			};
		}
	},
	data: {}
};

module.exports = cache;
