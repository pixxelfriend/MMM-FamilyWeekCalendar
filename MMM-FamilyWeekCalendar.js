/* global Module, Log, moment, CalendarUtils */

/* Magic Mirror
 * Module: MMM-FamilyWeekCalendar
 *
 * By Steffen Hoffmann http://www.twolabs.de
 * Based on the calendar module by Michael Teeuw http://michaelteeuw.nl
 * MIT Licensed.
 */

Module.register("MMM-FamilyWeekCalendar", {

	// Define module defaults
	defaults: {
		maximumEntries: 20, // Total Maximum Entries
		maximumNumberOfDays: 7,
		limitDays: 0, // Limit the number of days shown, 0 = no limit
		pastDaysCount: 0,
		displaySymbol: true,
		defaultSymbol: "calendar-days", // Fontawesome Symbol see https://fontawesome.com/search?ic=free&o=r
		defaultSymbolClassName: "fas fa-fw fa-",
		showLocation: false,
		displayRepeatingCountTitle: false,
		defaultRepeatingCountTitle: "",
		maxTitleLength: 30,
		maxLocationTitleLength: 25,
		wrapEvents: false, // Wrap events to multiple lines breaking at maxTitleLength
		wrapLocationEvents: false,
		maxTitleLines: 3,
		maxEventTitleLines: 3,
		fetchInterval: 5 * 60 * 1000, // Update every 5 minutes.
		animationSpeed: 2000,
		fade: true,
		fadePoint: 0.25, // Start on 1/4th of the list.
		urgency: 7,
		timeFormat: "dateheaders",
		dateFormat: "MMM Do",
		dateEndFormat: "LT",
		fullDayEventDateFormat: "MMM Do",
		showEnd: false,
		showEndsOnlyWithDuration: false,
		getRelative: 6,
		hidePrivate: false,
		hideOngoing: false,
		hideTime: false,
		hideDuplicates: true,
		showTimeToday: false,
		colored: false,
		forceUseCurrentTime: false,
		tableClass: "small",
		calendars: [
			{
				symbol: "calendar-alt",
				url: "https://www.calendarlabs.com/templates/ical/US-Holidays.ics"
			},
		],
		customEvents: [
			// Array of {keyword: "", symbol: "", color: "", eventClass: ""} where Keyword is a regexp and symbol/color/eventClass are to be applied for matched
			{ keyword: ".*", transform: { search: "De verjaardag van ", replace: "" } },
			{ keyword: ".*", transform: { search: "'s birthday", replace: "" } }
		],
		locationTitleReplace: {
			"street ": ""
		},
		broadcastEvents: true,
		excludedEvents: [],
		sliceMultiDayEvents: false,
		broadcastPastEvents: false,
		nextDaysRelative: false,
		selfSignedCert: false,
		coloredText: false,
		coloredBorder: false,
		coloredSymbol: false,
		coloredBackground: false,
		limitDaysNeverSkip: false,
		flipDateHeaderTitle: false,
		updateOnFetch: true
	},

	// Define required scripts.
	getStyles() {
		return ["MMM-FamilyWeekCalendar.css", "font-awesome.css"];
	},

	// Define required scripts.
	getScripts() {
		return ["calendarutils.js", "moment.js", "moment-timezone.js"];
	},

	// Define required translations.
	getTranslations() {

		/*
 * The translations for the default modules are defined in the core translation files.
 * Therefore we can just return false. Otherwise we should have returned a dictionary.
 * If you're trying to build your own module including translations, check out the documentation.
 */
		return false;
	},

	// Override start method.
	start() {
		Log.info(`Starting module: ${this.name}`);

		if (this.config.colored) {
			Log.warn("[MMM-FamilyWeekCalendar] Your are using the deprecated config values 'colored'. Please switch to 'coloredSymbol' & 'coloredText'!");
			this.config.coloredText = true;
			this.config.coloredSymbol = true;
		}
		if (this.config.coloredSymbolOnly) {
			Log.warn("[MMM-FamilyWeekCalendar] Your are using the deprecated config values 'coloredSymbolOnly'. Please switch to 'coloredSymbol' & 'coloredText'!");
			this.config.coloredText = false;
			this.config.coloredSymbol = true;
		}

		// Set locale.
		moment.updateLocale(config.language, CalendarUtils.getLocaleSpecification(config.timeFormat));

		// clear data holder before start
		this.calendarData = {};

		// indicate no data available yet
		this.loaded = false;

		// data holder of calendar url. Avoid fade out/in on updateDom (one for each calendar update)
		this.calendarDisplayer = {};

		this.config.calendars.forEach((calendar) => {
			calendar.url = calendar.url.replace("webcal://", "http://");

			const calendarConfig = {
				maximumEntries: calendar.maximumEntries,
				maximumNumberOfDays: calendar.maximumNumberOfDays,
				pastDaysCount: calendar.pastDaysCount,
				broadcastPastEvents: calendar.broadcastPastEvents,
				selfSignedCert: calendar.selfSignedCert,
				excludedEvents: calendar.excludedEvents,
				fetchInterval: calendar.fetchInterval
			};

			if (typeof calendar.symbolClass === "undefined" || calendar.symbolClass === null) {
				calendarConfig.symbolClass = "";
			}
			if (typeof calendar.titleClass === "undefined" || calendar.titleClass === null) {
				calendarConfig.titleClass = "";
			}
			if (typeof calendar.timeClass === "undefined" || calendar.timeClass === null) {
				calendarConfig.timeClass = "";
			}

			// we check user and password here for backwards compatibility with old configs
			if (calendar.user && calendar.pass) {
				Log.warn("[MMM-FamilyWeekCalendar] Deprecation warning: Please update your calendar authentication configuration.");
				Log.warn("https://docs.magicmirror.builders/modules/calendar.html#configuration-options");
				calendar.auth = {
					user: calendar.user,
					pass: calendar.pass
				};
			}

			/*
			 * tell helper to start a fetcher for this calendar
			 * fetcher till cycle
			 */
			this.addCalendar(calendar.url, calendar.auth, calendarConfig);
		});

		// for backward compatibility titleReplace
		if (typeof this.config.titleReplace !== "undefined") {
			Log.warn("[MMM-FamilyWeekCalendar] Deprecation warning: Please consider upgrading your calendar titleReplace configuration to customEvents.");
			for (const [titlesearchstr, titlereplacestr] of Object.entries(this.config.titleReplace)) {
				this.config.customEvents.push({ keyword: ".*", transform: { search: titlesearchstr, replace: titlereplacestr } });
			}
		}

		this.selfUpdate();
	},

	notificationReceived(notification, payload) {
		if (notification === "FETCH_CALENDAR") {
			this.sendSocketNotification(notification, { url: payload.url, id: this.identifier });
		}
	},

	// Override socket notification handler.
	socketNotificationReceived(notification, payload) {

		if (this.identifier !== payload.id) {
			return;
		}

		if (notification === "CALENDAR_EVENTS") {
			// have we received events for this url
			if (!this.calendarData[payload.url]) {
				// no, setup the structure to hold the info
				this.calendarData[payload.url] = { events: null, checksum: null };
			}
			// save the event list
			this.calendarData[payload.url].events = payload.events;

			this.error = null;
			this.loaded = true;

			if (this.config.broadcastEvents) {
				this.broadcastEvents();
			}
			// if the checksum is the same
			if (this.calendarData[payload.url].checksum === payload.checksum) {
				// then don't update the UI
				return;
			}
			// haven't seen or the checksum is different
			this.calendarData[payload.url].checksum = payload.checksum;

			if (!this.config.updateOnFetch) {
				if (this.calendarDisplayer[payload.url] === undefined) {
					// calendar will never displayed, so display it
					this.updateDom(this.config.animationSpeed);
					// set this calendar as displayed
					this.calendarDisplayer[payload.url] = true;
				} else {
					Log.debug("[MMM-FamilyWeekCalendar] DOM not updated waiting self update()");
				}
				return;
			}
		} else if (notification === "CALENDAR_ERROR") {
			let error_message = this.translate(payload.error_type);
			this.error = this.translate("MODULE_CONFIG_ERROR", { MODULE_NAME: this.name, ERROR: error_message });
			this.loaded = true;
		}

		this.updateDom(this.config.animationSpeed);
	},

	// Override dom generator.
	getDom() {
		let day = moment();
		const dayKeyFormat = "YYYY-MM-DD";
		let currentFadeStep = 0;
		const upcommingDays = {};
		const endOfDays = day.clone().add(this.config.maximumNumberOfDays, "days");

		const events = this.createEventList(true);
		const wrapper = document.createElement("table");
		wrapper.className = this.config.tableClass;

		if (this.error) {
			wrapper.innerHTML = this.error;
			wrapper.className = `${this.config.tableClass} dimmed`;
			return wrapper;
		}

		if (events.length === 0) {
			wrapper.innerHTML = this.loaded ? this.translate("EMPTY") : this.translate("LOADING");
			wrapper.className = `${this.config.tableClass} dimmed`;
			return wrapper;
		}

		while (day.isBefore(endOfDays, "day")) {
			const dayKey = day.format(dayKeyFormat);
			upcommingDays[dayKey] = {};
			for (let calendar of this.config.calendars) {
				upcommingDays[dayKey][calendar.url] = [];
			}
			day.add(1, "day");
		}

		let startFade;
		let fadeSteps;

		if (this.config.fade && this.config.fadePoint < 1) {
			if (this.config.fadePoint < 0) {
				this.config.fadePoint = 0;
			}
			startFade = this.config.maximumNumberOfDays * this.config.fadePoint;
			fadeSteps = this.config.maximumNumberOfDays - startFade;
		}

		/* Sort the event into the day / calendar object */
		for (const event of events) {
			const endMoment = this.timestampToMoment(event.endDate);
			const startMoment = this.timestampToMoment(event.startDate);
			const currentEvent = {
				description: event.description,
				fullDayEvent: event.fullDayEvent,
				geo: event.geo,
				location: event.location,
				title: event.title,
				today: event.today,
				url: event.url,
				firstYear: event.firstYear,
				recurringEvent: event.recurringEvent,
				startDate: event.startDate,
				endDate: event.endDate
			};

			/* Multi day events  */
			if (!this.isSameDay(startMoment, endMoment)) {
				const diff = endMoment.diff(startMoment, "days");
				/* Fix for fullDayEvent: They will be recognized as multiday event, because it ends on 0:00 of the next day */
				if (event.fullDayEvent && diff === 1) {
					const dateKey = startMoment.format(dayKeyFormat);
					if (upcommingDays[dateKey] && upcommingDays[dateKey][currentEvent.url]) {
						upcommingDays[dateKey][currentEvent.url].push(event);
					}
				}
				/* all other full day events */
				else if (event.fullDayEvent) {
					for (const dKey in upcommingDays) {
						if (moment(dKey).isBetween(startMoment.format(dayKeyFormat), endMoment.format(dayKeyFormat)) || startMoment.isSame(dKey, "day")) {
							const dayEvent = { ...currentEvent };
							dayEvent.startDate = event.startDate;
							dayEvent.endDate = endMoment.endOf("day").format("x");
							if (upcommingDays[dKey] && upcommingDays[dKey][dayEvent.url]) {
								upcommingDays[dKey][dayEvent.url].push(dayEvent);
							}
						}
					}
					/* multiday events which are not fullday */
				} else {
					for (const dKey in upcommingDays) {
						const clonedEvent = { ...currentEvent };
						if (startMoment.isSame(dKey, "day")) {
							clonedEvent.fullDayEvent = false;
							clonedEvent.startDate = event.startDate;
							if (upcommingDays[dKey] && upcommingDays[dKey][clonedEvent.url]) {
								upcommingDays[dKey][clonedEvent.url].push(clonedEvent);
							}
						} else if (endMoment.isSame(dKey, "day")) {
							clonedEvent.fullDayEvent = false;
							clonedEvent.endDate = endMoment.endOf("day").format("x");
							if (upcommingDays[dKey] && upcommingDays[dKey][clonedEvent.url]) {
								upcommingDays[dKey][clonedEvent.url].push(clonedEvent);
							}
						}
						if (moment(dKey).isBetween(startMoment.format(dayKeyFormat), endMoment.format(dayKeyFormat))) {
							if (upcommingDays[dKey] && upcommingDays[dKey][clonedEvent.url]) {
								upcommingDays[dKey][clonedEvent.url].push(clonedEvent);
							}
						}
					}
				}
			}
			/* Single day events */
			else {
				const dateKey = startMoment.format(dayKeyFormat);
				if (upcommingDays[dateKey] && upcommingDays[dateKey][currentEvent.url]) {
					upcommingDays[dateKey][currentEvent.url].push(event);
				}
			}
		}

		/* Create Table Header */
		const tableHeadRow = document.createElement("tr");
		tableHeadRow.appendChild(document.createElement("th"));
		for (const calendar of this.config.calendars) {
			const col = document.createElement("th");
			col.innerHTML = calendar.name || "";
			tableHeadRow.appendChild(col);
		}
		wrapper.appendChild(tableHeadRow);

		/* Create table rows for each day */
		Object.keys(upcommingDays).forEach((day, index) => {
			const row = document.createElement("tr");
			const calendars = upcommingDays[day];

			// fading
			if (this.config.fade && index >= startFade) {
				currentFadeStep = index - startFade;
				row.style.opacity = 1 - (1 / fadeSteps) * currentFadeStep;
			}

			const dayLabel = document.createElement("td");
			dayLabel.innerHTML = moment(day).format("dd");
			row.appendChild(dayLabel);

			/* one column for each calendar */
			for (const calendarUrl in calendars) {
				const calendarColumn = document.createElement("td");
				for (const event of upcommingDays[day][calendarUrl]) {
					const eventContent = document.createElement("p");

					const time = document.createElement("span");
					time.className = `time ${this.timeClassForUrl(event.url)}`;
					if (!event.fullDayEvent) {
						time.innerText = event.startDate ? this.timestampToMoment(event.startDate).format("LT") : "";
					}
					eventContent.appendChild(time);

					const title = document.createElement("span");
					title.className = `title ${this.titleClassForUrl(event.url)}`;

					// Repeating count in title
					let repeatingCountTitle = "";
					if (this.config.displayRepeatingCountTitle && event.firstYear !== undefined) {
						repeatingCountTitle = this.countTitleForUrl(event.url);
						if (repeatingCountTitle !== "") {
							const thisYear = this.timestampToMoment(event.startDate).year(),
								yearDiff = thisYear - event.firstYear;
							if (yearDiff > 0) {
								repeatingCountTitle = `, ${yearDiff} ${repeatingCountTitle}`;
							}
						}
					}

					let transformedTitle = event.title;
					if (this.config.customEvents && this.config.customEvents.length > 0) {
						for (const ev of this.config.customEvents) {
							const needle = new RegExp(ev.keyword, "gi");
							if (needle.test(event.title)) {
								if (typeof ev.transform === "object") {
									transformedTitle = CalendarUtils.titleTransform(transformedTitle, [ev.transform]);
								}
								if (typeof ev.color !== "undefined" && ev.color !== "") {
									if (this.config.coloredText) {
										eventContent.style.color = ev.color;
									}
								}
								if (typeof ev.eventClass !== "undefined" && ev.eventClass !== "") {
									eventContent.className += ` ${ev.eventClass}`;
								}
							}
						}
					}

					title.innerHTML = CalendarUtils.shorten(transformedTitle, this.config.maxTitleLength, this.config.wrapEvents, this.config.maxTitleLines) + repeatingCountTitle;

					if (this.config.showLocation && event.location) {
						const location = document.createElement("span");
						location.className = "location";
						location.innerText = `(${event.location})`;
						title.appendChild(document.createTextNode(" "));
						title.appendChild(location);
					}

					// Option to support symbols
					if (this.config.displaySymbol) {
						const symbolSpan = document.createElement("span");
						symbolSpan.className = `symbol ${this.symbolClassForUrl(event.url)}`;
						if (this.config.coloredSymbol) {
							symbolSpan.style.color = this.colorForUrl(event.url, false);
						}
						const symbols = this.symbolsForEvent(event);
						symbols.forEach((s) => {
							const symbol = document.createElement("span");
							symbol.className = s;
							symbolSpan.appendChild(symbol);
						});
						eventContent.appendChild(symbolSpan);
					}

					eventContent.appendChild(title);

					if (this.config.coloredText && !eventContent.style.color) {
						eventContent.style.color = this.colorForUrl(event.url, false);
					}

					calendarColumn.appendChild(eventContent);
				}
				row.appendChild(calendarColumn);
			}
			wrapper.appendChild(row);
		});
		return wrapper;
	},

	/**
	 * Converts the given timestamp to a moment with a timezone
	 * @param {number} timestamp timestamp from an event
	 * @returns {moment.Moment} moment with a timezone
	 */
	timestampToMoment(timestamp) {
		return moment(timestamp, "x").tz(moment.tz.guess());
	},

	/**
	 * Creates the sorted list of all events.
	 * @param {boolean} limitNumberOfEntries Whether to filter returned events for display.
	 * @returns {object[]} Array with events.
	 */
	createEventList(limitNumberOfEntries) {
		let now = moment();
		let future = now.clone().startOf("day").add(this.config.maximumNumberOfDays, "days");

		let events = [];

		for (const calendarUrl in this.calendarData) {
			const calendar = this.calendarData[calendarUrl].events;
			let remainingEntries = this.maximumEntriesForUrl(calendarUrl);
			let maxPastDaysCompare = now.clone().subtract(this.maximumPastDaysForUrl(calendarUrl), "days");
			let by_url_calevents = [];
			for (const e in calendar) {
				const event = JSON.parse(JSON.stringify(calendar[e])); // clone object
				const eventStartDateMoment = this.timestampToMoment(event.startDate);
				const eventEndDateMoment = this.timestampToMoment(event.endDate);

				if (this.config.hidePrivate && event.class === "PRIVATE") {
					// do not add the current event, skip it
					continue;
				}
				if (limitNumberOfEntries) {
					if (eventEndDateMoment.isBefore(maxPastDaysCompare)) {
						continue;
					}
					if (this.config.hideOngoing && eventStartDateMoment.isBefore(now)) {
						continue;
					}
					if (this.config.hideDuplicates && this.listContainsEvent(events, event)) {
						continue;
					}
				}

				event.url = calendarUrl;
				event.today = eventStartDateMoment.isSame(now, "d");
				event.dayBeforeYesterday = eventStartDateMoment.isSame(now.clone().subtract(2, "days"), "d");
				event.yesterday = eventStartDateMoment.isSame(now.clone().subtract(1, "days"), "d");
				event.tomorrow = eventStartDateMoment.isSame(now.clone().add(1, "days"), "d");
				event.dayAfterTomorrow = eventStartDateMoment.isSame(now.clone().add(2, "days"), "d");

				/*
				 * if sliceMultiDayEvents is set to true, multiday events (events exceeding at least one midnight) are sliced into days,
				 * otherwise, esp. in dateheaders mode it is not clear how long these events are.
				 */
				const maxCount = eventEndDateMoment.diff(eventStartDateMoment, "days");
				if (this.config.sliceMultiDayEvents && maxCount > 1) {
					const splitEvents = [];
					let midnight
						= eventStartDateMoment
							.clone()
							.startOf("day")
							.add(1, "day")
							.endOf("day");
					let count = 1;
					while (eventEndDateMoment.isAfter(midnight)) {
						const thisEvent = JSON.parse(JSON.stringify(event)); // clone object
						thisEvent.today = this.timestampToMoment(thisEvent.startDate).isSame(now, "d");
						thisEvent.tomorrow = this.timestampToMoment(thisEvent.startDate).isSame(now.clone().add(1, "days"), "d");
						thisEvent.endDate = midnight.clone().subtract(1, "day").format("x");
						thisEvent.title += ` (${count}/${maxCount})`;
						splitEvents.push(thisEvent);

						event.startDate = midnight.format("x");
						count += 1;
						midnight = midnight.clone().add(1, "day").endOf("day"); // next day
					}
					// Last day
					event.title += ` (${count}/${maxCount})`;
					event.today += this.timestampToMoment(event.startDate).isSame(now, "d");
					event.tomorrow = this.timestampToMoment(event.startDate).isSame(now.clone().add(1, "days"), "d");
					splitEvents.push(event);

					for (let splitEvent of splitEvents) {
						if (this.timestampToMoment(splitEvent.endDate).isAfter(now) && this.timestampToMoment(splitEvent.endDate).isSameOrBefore(future)) {
							by_url_calevents.push(splitEvent);
						}
					}
				} else {
					by_url_calevents.push(event);
				}
			}
			if (limitNumberOfEntries) {
				// sort entries before clipping
				by_url_calevents.sort(function (a, b) {
					return a.startDate - b.startDate;
				});
				Log.debug(`[MMM-FamilyWeekCalendar] pushing ${by_url_calevents.length} events to total with room for ${remainingEntries}`);
				events = events.concat(by_url_calevents.slice(0, remainingEntries));
				Log.debug(`[MMM-FamilyWeekCalendar] events for calendar=${events.length}`);
			} else {
				events = events.concat(by_url_calevents);
			}
		}
		Log.info(`[MMM-FamilyWeekCalendar] sorting events count=${events.length}`);
		events.sort(function (a, b) {
			return a.startDate - b.startDate;
		});

		if (!limitNumberOfEntries) {
			return events;
		}

		/*
		 * Limit the number of days displayed
		 * If limitDays is set > 0, limit display to that number of days
		 */
		if (this.config.limitDays > 0 && events.length > 0) { // watch out for initial display before events arrive from helper
			// Group all events by date, events on the same date will be in a list with the key being the date.
			const eventsByDate = Object.groupBy(events, (ev) => this.timestampToMoment(ev.startDate).format("YYYY-MM-DD"));
			const newEvents = [];
			let currentDate = moment();
			let daysCollected = 0;

			while (daysCollected < this.config.limitDays) {
				const dateStr = currentDate.format("YYYY-MM-DD");
				// Check if there are events on the currentDate
				if (eventsByDate[dateStr] && eventsByDate[dateStr].length > 0) {
					// If there are any events today then get all those events and select the currently active events and the events that are starting later in the day.
					newEvents.push(...eventsByDate[dateStr].filter((ev) => this.timestampToMoment(ev.endDate).isAfter(moment())));
					// Since we found a day with events, increase the daysCollected by 1
					daysCollected++;
				}
				// Search for the next day
				currentDate.add(1, "day");
			}
			events = newEvents;
		}
		Log.info(`[MMM-FamilyWeekCalendar] slicing events total maxCount=${this.config.maximumEntries}`);
		return events.slice(0, this.config.maximumEntries);
	},

	listContainsEvent(eventList, event) {
		for (const evt of eventList) {
			if (evt.title === event.title && parseInt(evt.startDate) === parseInt(event.startDate) && parseInt(evt.endDate) === parseInt(event.endDate)) {
				return true;
			}
		}
		return false;
	},

	/**
	 * Requests node helper to add calendar url.
	 * @param {string} url The calendar url to add
	 * @param {object} auth The authentication method and credentials
	 * @param {object} calendarConfig The config of the specific calendar
	 */
	addCalendar(url, auth, calendarConfig) {
		this.sendSocketNotification("ADD_CALENDAR", {
			id: this.identifier,
			url: url,
			excludedEvents: calendarConfig.excludedEvents || this.config.excludedEvents,
			maximumEntries: calendarConfig.maximumEntries || this.config.maximumEntries,
			maximumNumberOfDays: calendarConfig.maximumNumberOfDays || this.config.maximumNumberOfDays,
			pastDaysCount: calendarConfig.pastDaysCount || this.config.pastDaysCount,
			fetchInterval: calendarConfig.fetchInterval || this.config.fetchInterval,
			symbolClass: calendarConfig.symbolClass,
			titleClass: calendarConfig.titleClass,
			timeClass: calendarConfig.timeClass,
			auth: auth,
			broadcastPastEvents: calendarConfig.broadcastPastEvents || this.config.broadcastPastEvents,
			selfSignedCert: calendarConfig.selfSignedCert || this.config.selfSignedCert
		});
	},

	/**
	 * Retrieves the symbols for a specific event.
	 * @param {object} event Event to look for.
	 * @returns {string[]} The symbols
	 */
	symbolsForEvent(event) {
		let symbols = this.getCalendarPropertyAsArray(event.url, "symbol", this.config.defaultSymbol);

		if (event.recurringEvent === true && this.hasCalendarProperty(event.url, "recurringSymbol")) {
			symbols = this.mergeUnique(this.getCalendarPropertyAsArray(event.url, "recurringSymbol", this.config.defaultSymbol), symbols);
		}

		if (event.fullDayEvent === true && this.hasCalendarProperty(event.url, "fullDaySymbol")) {
			symbols = this.mergeUnique(this.getCalendarPropertyAsArray(event.url, "fullDaySymbol", this.config.defaultSymbol), symbols);
		}

		// If custom symbol is set, replace event symbol
		for (let ev of this.config.customEvents) {
			if (typeof ev.symbol !== "undefined" && ev.symbol !== "") {
				let needle = new RegExp(ev.keyword, "gi");
				if (needle.test(event.title)) {
					// Get the default prefix for this class name and add to the custom symbol provided
					const className = this.getCalendarProperty(event.url, "symbolClassName", this.config.defaultSymbolClassName);
					symbols[0] = className + ev.symbol;
					break;
				}
			}
		}

		return symbols;
	},

	mergeUnique(arr1, arr2) {
		return arr1.concat(
			arr2.filter(function (item) {
				return arr1.indexOf(item) === -1;
			})
		);
	},

	createDateHeadersTimeWrapper(url) {
		const timeWrapper = document.createElement("td");
		timeWrapper.className = `time light ${this.config.flipDateHeaderTitle ? "align-right " : "align-left "}${this.timeClassForUrl(url)}`;
		timeWrapper.style.paddingLeft = "2px";
		timeWrapper.style.textAlign = this.config.flipDateHeaderTitle ? "right" : "left";
		return timeWrapper;
	},

	hasEventDuration(event) {
		return event.startDate !== event.endDate;
	},

	shouldShowDateHeadersTimedEnd(event) {
		return this.config.showEnd && (!this.config.showEndsOnlyWithDuration || this.hasEventDuration(event));
	},

	shouldShowRelativeTimedEnd(event) {
		return !this.config.hideTime && this.config.showEnd && (!this.config.showEndsOnlyWithDuration || this.hasEventDuration(event));
	},

	getAdjustedFullDayEndMoment(endMoment) {
		return endMoment.clone().subtract(1, "second");
	},

	renderDateHeadersEventTime(eventWrapper, titleWrapper, event, eventStartDateMoment, eventEndDateMoment) {
		if (this.config.flipDateHeaderTitle) eventWrapper.appendChild(titleWrapper);

		if (event.fullDayEvent) {
			const adjustedEndMoment = this.getAdjustedFullDayEndMoment(eventEndDateMoment);
			if (this.config.showEnd && !this.config.showEndsOnlyWithDuration && !eventStartDateMoment.isSame(adjustedEndMoment, "d")) {
				const timeWrapper = this.createDateHeadersTimeWrapper(event.url);
				timeWrapper.innerHTML = `-${CalendarUtils.capFirst(adjustedEndMoment.format(this.config.fullDayEventDateFormat))}`;
				eventWrapper.appendChild(timeWrapper);
				if (!this.config.flipDateHeaderTitle) titleWrapper.classList.add("align-right");
			} else {
				titleWrapper.colSpan = "2";
				titleWrapper.classList.add("align-left");
			}
		} else {
			const timeWrapper = this.createDateHeadersTimeWrapper(event.url);
			timeWrapper.innerHTML = eventStartDateMoment.format("LT");

			// In dateheaders mode, keep the end as time-only to avoid redundant date info under a date header.
			if (this.shouldShowDateHeadersTimedEnd(event)) {
				timeWrapper.innerHTML += `-${CalendarUtils.capFirst(eventEndDateMoment.format("LT"))}`;
			}

			eventWrapper.appendChild(timeWrapper);
			if (!this.config.flipDateHeaderTitle) titleWrapper.classList.add("align-right");
		}

		if (!this.config.flipDateHeaderTitle) eventWrapper.appendChild(titleWrapper);
	},

	buildAbsoluteTimeText(event, eventStartDateMoment, eventEndDateMoment, now) {
		let timeText = CalendarUtils.capFirst(eventStartDateMoment.format(this.config.dateFormat));

		if (this.config.showEnd && (!this.config.showEndsOnlyWithDuration || this.hasEventDuration(event))) {
			const sameDay = this.isSameDay(eventStartDateMoment, eventEndDateMoment);
			if (sameDay && !this.dateFormatIncludesTime()) {
				timeText += `, ${eventStartDateMoment.format("LT")}`;
			}
			timeText += `-${this.formatTimedEventEnd(eventStartDateMoment, eventEndDateMoment)}`;
		}

		if (event.fullDayEvent) {
			const adjustedEndMoment = this.getAdjustedFullDayEndMoment(eventEndDateMoment);
			timeText = CalendarUtils.capFirst(eventStartDateMoment.format(this.config.fullDayEventDateFormat));

			if (this.config.showEnd && !this.config.showEndsOnlyWithDuration && !eventStartDateMoment.isSame(adjustedEndMoment, "d")) {
				timeText += `-${CalendarUtils.capFirst(adjustedEndMoment.format(this.config.fullDayEventDateFormat))}`;
			} else if (!eventStartDateMoment.isSame(adjustedEndMoment, "d") && eventStartDateMoment.isBefore(now)) {
				timeText = CalendarUtils.capFirst(now.format(this.config.fullDayEventDateFormat));
			}

			if (this.config.nextDaysRelative) {
				let relativeLabel = false;
				if (event.today) {
					timeText = CalendarUtils.capFirst(this.translate("TODAY"));
					relativeLabel = true;
				} else if (event.yesterday) {
					timeText = CalendarUtils.capFirst(this.translate("YESTERDAY"));
					relativeLabel = true;
				} else if (event.tomorrow) {
					timeText = CalendarUtils.capFirst(this.translate("TOMORROW"));
					relativeLabel = true;
				} else if (event.dayAfterTomorrow && this.translate("DAYAFTERTOMORROW") !== "DAYAFTERTOMORROW") {
					timeText = CalendarUtils.capFirst(this.translate("DAYAFTERTOMORROW"));
					relativeLabel = true;
				}

				if (relativeLabel && this.config.showEnd && !this.config.showEndsOnlyWithDuration && !eventStartDateMoment.isSame(adjustedEndMoment, "d")) {
					timeText += `-${CalendarUtils.capFirst(adjustedEndMoment.format(this.config.fullDayEventDateFormat))}`;
				}
			}

			return timeText;
		}

		if (this.config.getRelative > 0 && eventStartDateMoment.isBefore(now)) {
			return CalendarUtils.capFirst(
				this.translate("RUNNING", {
					fallback: `${this.translate("RUNNING")} {timeUntilEnd}`,
					timeUntilEnd: eventEndDateMoment.fromNow(true)
				})
			);
		}

		if (this.config.urgency > 0 && eventStartDateMoment.diff(now, "d") < this.config.urgency) {
			return CalendarUtils.capFirst(eventStartDateMoment.fromNow());
		}

		return timeText;
	},

	buildRelativeTimeText(event, eventStartDateMoment, eventEndDateMoment, now) {
		if (eventStartDateMoment.isSameOrAfter(now) || (event.fullDayEvent && eventEndDateMoment.diff(now, "days") === 0)) {
			let timeText;

			if (!this.config.hideTime && !event.fullDayEvent) {
				Log.debug("[MMM-FamilyWeekCalendar] event not hidden and not fullday");
				timeText = `${CalendarUtils.capFirst(eventStartDateMoment.calendar(null, {
					sameDay: this.config.showTimeToday ? "LT" : `[${this.translate("TODAY")}]`,
					nextDay: `[${this.translate("TOMORROW")}]`,
					nextWeek: "dddd",
					sameElse: event.fullDayEvent ? this.config.fullDayEventDateFormat : this.config.dateFormat
				}))}`;
			} else {
				Log.debug("[MMM-FamilyWeekCalendar] event full day or hidden");
				timeText = `${CalendarUtils.capFirst(
					eventStartDateMoment.calendar(null, {
						sameDay: this.config.showTimeToday ? "LT" : `[${this.translate("TODAY")}]`,
						nextDay: `[${this.translate("TOMORROW")}]`,
						nextWeek: "dddd",
						sameElse: event.fullDayEvent ? this.config.fullDayEventDateFormat : this.config.dateFormat
					})
				)}`;
			}

			if (event.fullDayEvent) {
				if (event.today || (event.fullDayEvent && eventEndDateMoment.diff(now, "days") === 0)) {
					timeText = CalendarUtils.capFirst(this.translate("TODAY"));
				} else if (event.dayBeforeYesterday) {
					if (this.translate("DAYBEFOREYESTERDAY") !== "DAYBEFOREYESTERDAY") {
						timeText = CalendarUtils.capFirst(this.translate("DAYBEFOREYESTERDAY"));
					}
				} else if (event.yesterday) {
					timeText = CalendarUtils.capFirst(this.translate("YESTERDAY"));
				} else if (event.tomorrow) {
					timeText = CalendarUtils.capFirst(this.translate("TOMORROW"));
				} else if (event.dayAfterTomorrow) {
					if (this.translate("DAYAFTERTOMORROW") !== "DAYAFTERTOMORROW") {
						timeText = CalendarUtils.capFirst(this.translate("DAYAFTERTOMORROW"));
					}
				}

				if (this.config.showEnd && !this.config.showEndsOnlyWithDuration) {
					const adjustedEndMoment = this.getAdjustedFullDayEndMoment(eventEndDateMoment);
					if (!eventStartDateMoment.isSame(adjustedEndMoment, "d")) {
						timeText += `-${CalendarUtils.capFirst(adjustedEndMoment.format(this.config.fullDayEventDateFormat))}`;
					}
				}

				Log.info("[MMM-FamilyWeekCalendar] event fullday");
			} else if (eventStartDateMoment.diff(now, "h") < this.config.getRelative) {
				Log.info("[MMM-FamilyWeekCalendar] not full day but within getRelative size");
				timeText = `${CalendarUtils.capFirst(eventStartDateMoment.fromNow())}`;
			} else if (this.shouldShowRelativeTimedEnd(event)) {
				if (this.isSameDay(eventStartDateMoment, eventEndDateMoment)) {
					const sameElseFormat = this.dateFormatIncludesTime() ? this.config.dateFormat : `${this.config.dateFormat}, LT`;
					timeText = CalendarUtils.capFirst(
						eventStartDateMoment.calendar(null, { sameElse: sameElseFormat })
					);
				}
				timeText += `-${this.formatTimedEventEnd(eventStartDateMoment, eventEndDateMoment)}`;
			}

			return timeText;
		}

		return CalendarUtils.capFirst(
			this.translate("RUNNING", {
				fallback: `${this.translate("RUNNING")} {timeUntilEnd}`,
				timeUntilEnd: eventEndDateMoment.fromNow(true)
			})
		);
	},

	/**
	 * Determines whether two moments are on the same day.
	 * @param {moment.Moment} startMoment The start moment.
	 * @param {moment.Moment} endMoment The end moment.
	 * @returns {boolean} True when both moments share the same calendar day.
	 */
	isSameDay(startMoment, endMoment) {
		return startMoment.isSame(endMoment, "d");
	},

	/**
	 * Checks whether the configured dateFormat already contains time components.
	 * @returns {boolean} True when dateFormat includes time tokens.
	 */
	dateFormatIncludesTime() {
		const dateFormatWithoutLiterals = this.config.dateFormat.replace(/\[[^\]]*\]/g, "");
		const localeDateFormat = moment.localeData();
		const expandedDateFormat = dateFormatWithoutLiterals.replace(
			/LTS|LT|LLLL|LLL|LL|L|llll|lll|ll|l/g,
			(token) => localeDateFormat.longDateFormat(token) || token
		);
		const expandedDateFormatWithoutLiterals = expandedDateFormat.replace(/\[[^\]]*\]/g, "");
		return (/(H{1,2}|h{1,2}|k{1,2}|m{1,2}|s{1,2}|a|A)/).test(expandedDateFormatWithoutLiterals);
	},

	/**
	 * Formats a timed event end value.
	 * Uses time-only for same-day events and dateEndFormat for multi-day events.
	 * @param {moment.Moment} startMoment The event start moment.
	 * @param {moment.Moment} endMoment The event end moment.
	 * @returns {string} The formatted end value.
	 */
	formatTimedEventEnd(startMoment, endMoment) {
		const endFormat = this.isSameDay(startMoment, endMoment) ? "LT" : this.config.dateEndFormat;
		return CalendarUtils.capFirst(endMoment.format(endFormat));
	},

	/**
	 * Retrieves the symbolClass for a specific calendar url.
	 * @param {string} url The calendar url
	 * @returns {string} The class to be used for the symbols of the calendar
	 */
	symbolClassForUrl(url) {
		return this.getCalendarProperty(url, "symbolClass", "");
	},

	/**
	 * Retrieves the titleClass for a specific calendar url.
	 * @param {string} url The calendar url
	 * @returns {string} The class to be used for the title of the calendar
	 */
	titleClassForUrl(url) {
		return this.getCalendarProperty(url, "titleClass", "");
	},

	/**
	 * Retrieves the timeClass for a specific calendar url.
	 * @param {string} url The calendar url
	 * @returns {string} The class to be used for the time of the calendar
	 */
	timeClassForUrl(url) {
		return this.getCalendarProperty(url, "timeClass", "");
	},

	/**
	 * Retrieves the calendar name for a specific calendar url.
	 * @param {string} url The calendar url
	 * @returns {string} The name of the calendar
	 */
	calendarNameForUrl(url) {
		return this.getCalendarProperty(url, "name", "");
	},

	/**
	 * Retrieves the color for a specific calendar url.
	 * @param {string} url The calendar url
	 * @param {boolean} isBg Determines if we fetch the bgColor or not
	 * @returns {string} The color
	 */
	colorForUrl(url, isBg) {
		return this.getCalendarProperty(url, isBg ? "bgColor" : "color", "#fff");
	},

	/**
	 * Retrieves the count title for a specific calendar url.
	 * @param {string} url The calendar url
	 * @returns {string} The title
	 */
	countTitleForUrl(url) {
		return this.getCalendarProperty(url, "repeatingCountTitle", this.config.defaultRepeatingCountTitle);
	},

	/**
	 * Retrieves the maximum entry count for a specific calendar url.
	 * @param {string} url The calendar url
	 * @returns {number} The maximum entry count
	 */
	maximumEntriesForUrl(url) {
		return this.getCalendarProperty(url, "maximumEntries", this.config.maximumEntries);
	},

	/**
	 * Retrieves the maximum count of past days which events of should be displayed for a specific calendar url.
	 * @param {string} url The calendar url
	 * @returns {number} The maximum past days count
	 */
	maximumPastDaysForUrl(url) {
		return this.getCalendarProperty(url, "pastDaysCount", this.config.pastDaysCount);
	},

	/**
	 * Helper method to retrieve the property for a specific calendar url.
	 * @param {string} url The calendar url
	 * @param {string} property The property to look for
	 * @param {string} defaultValue The value if the property is not found
	 * @returns {string} The property
	 */
	getCalendarProperty(url, property, defaultValue) {
		for (const calendar of this.config.calendars) {
			if (calendar.url === url && calendar.hasOwnProperty(property)) {
				return calendar[property];
			}
		}

		return defaultValue;
	},

	getCalendarPropertyAsArray(url, property, defaultValue) {
		let p = this.getCalendarProperty(url, property, defaultValue);
		if (property === "symbol" || property === "recurringSymbol" || property === "fullDaySymbol") {
			const className = this.getCalendarProperty(url, "symbolClassName", this.config.defaultSymbolClassName);
			if (p instanceof Array) {
				let t = [];
				p.forEach((n) => { t.push(className + n); });
				p = t;
			}
			else p = className + p;
		}
		if (!(p instanceof Array)) p = [p];
		return p;
	},

	hasCalendarProperty(url, property) {
		return !!this.getCalendarProperty(url, property, undefined);
	},

	/**
	 * Broadcasts the events to all other modules for reuse.
	 * The all events available in one array, sorted on startDate.
	 */
	broadcastEvents() {
		const eventList = this.createEventList(false);
		for (const event of eventList) {
			event.symbol = this.symbolsForEvent(event);
			event.calendarName = this.calendarNameForUrl(event.url);
			event.color = this.colorForUrl(event.url, false);
			delete event.url;
		}

		this.sendNotification("CALENDAR_EVENTS", eventList);
	},

	/**
	 * Refresh the DOM every minute if needed: When using relative date format for events that start
	 * or end in less than an hour, the date shows minute granularity and we want to keep that accurate.
	 * --
	 * When updateOnFetch is not set, it will Avoid fade out/in on updateDom when many calendars are used
	 * and it's allow to refresh The DOM every minute with animation speed too
	 * (because updateDom is not set in CALENDAR_EVENTS for this case)
	 */
	selfUpdate() {
		const ONE_MINUTE = 60 * 1000;
		setTimeout(
			() => {
				setInterval(() => {
					Log.debug("[MMM-FamilyWeekCalendar] self update");
					if (this.config.updateOnFetch) {
						this.updateDom(1);
					} else {
						this.updateDom(this.config.animationSpeed);
					}
				}, ONE_MINUTE);
			},
			ONE_MINUTE - (new Date() % ONE_MINUTE)
		);
	}
});
