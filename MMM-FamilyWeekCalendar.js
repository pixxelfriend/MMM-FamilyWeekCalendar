/* global Module */

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
		displaySymbol: true,
		defaultSymbol: "calendar", // Fontawesome Symbol see http://fontawesome.io/cheatsheet/
		showLocation: false,
		displayRepeatingCountTitle: false,
		defaultRepeatingCountTitle: "",
		maxTitleLength: 25,
		wrapEvents: false, // wrap events to multiple lines breaking at maxTitleLength
		maxTitleLines: 3,
		fetchInterval: 5 * 60 * 1000, // Update every 5 minutes.
		animationSpeed: 2000,
		fade: true,
		urgency: 7,
		timeFormat: "dateheaders",
		dateFormat: "MMM Do",
		dateEndFormat: "LT",
		fullDayEventDateFormat: "MMM Do",
		showEnd: false,
		getRelative: 6,
		fadePoint: 0.25, // Start on 1/4th of the list.
		hidePrivate: false,
		hideOngoing: false,
		colored: false,
		coloredSymbolOnly: false,
		tableClass: "small",
		calendars: [
			{
				symbol: "calendar",
				url: "http://www.calendarlabs.com/templates/ical/US-Holidays.ics",
			},
		],
		titleReplace: {
			"De verjaardag van ": "",
			"'s birthday": ""
		},
		broadcastEvents: true,
		excludedEvents: [],
		sliceMultiDayEvents: false,
		broadcastPastEvents: false,
		nextDaysRelative: false
	},

	// Define required scripts.
	getStyles: function () {
		return ["MMM-FamilyWeekCalendar.css", "font-awesome.css"];
	},

	// Define required scripts.
	getScripts: function () {
		return ["moment.js"];
	},

	// Define required translations.
	getTranslations: function () {
		// The translations for the default modules are defined in the core translation files.
		// Therefor we can just return false. Otherwise we should have returned a dictionary.
		// If you're trying to build your own module including translations, check out the documentation.
		return false;
	},

	// Override start method.
	start: function () {
		Log.log("Starting module: " + this.name);

		// Set locale.
		moment.updateLocale(config.language, this.getLocaleSpecification(config.timeFormat));

		for (var c in this.config.calendars) {
			var calendar = this.config.calendars[c];
			calendar.url = calendar.url.replace("webcal://", "http://");

			var calendarConfig = {
				maximumEntries: calendar.maximumEntries,
				maximumNumberOfDays: calendar.maximumNumberOfDays,
				broadcastPastEvents: calendar.broadcastPastEvents,
			};
			if (calendar.symbolClass === "undefined" || calendar.symbolClass === null) {
				calendarConfig.symbolClass = "";
			}
			if (calendar.titleClass === "undefined" || calendar.titleClass === null) {
				calendarConfig.titleClass = "";
			}
			if (calendar.timeClass === "undefined" || calendar.timeClass === null) {
				calendarConfig.timeClass = "";
			}

			// we check user and password here for backwards compatibility with old configs
			if(calendar.user && calendar.pass) {
				Log.warn("Deprecation warning: Please update your calendar authentication configuration.");
				Log.warn("https://github.com/MichMich/MagicMirror/tree/v2.1.2/modules/default/calendar#calendar-authentication-options");
				calendar.auth = {
					user: calendar.user,
					pass: calendar.pass
				};
			}

			this.addCalendar(calendar.url, calendar.auth, calendarConfig);

			// Trigger ADD_CALENDAR every fetchInterval to make sure there is always a calendar
			// fetcher running on the server side.
			var self = this;
			setInterval(function() {
				self.addCalendar(calendar.url, calendar.auth, calendarConfig);
			}, self.config.fetchInterval);
		}

		this.calendarData = {};
		this.loaded = false;
	},

	// Override socket notification handler.
	socketNotificationReceived: function (notification, payload) {
		if (notification === "CALENDAR_EVENTS") {
			if (this.hasCalendarURL(payload.url)) {
				this.calendarData[payload.url] = payload.events;
				this.loaded = true;

				if (this.config.broadcastEvents) {
					this.broadcastEvents();
				}
			}
		} else if (notification === "FETCH_ERROR") {
			Log.error("Calendar Error. Could not fetch calendar: " + payload.url);
			this.loaded = true;
		} else if (notification === "INCORRECT_URL") {
			Log.error("Calendar Error. Incorrect url: " + payload.url);
		} else {
			Log.log("Calendar received an unknown socket notification: " + notification);
		}

		this.updateDom(this.config.animationSpeed);
	},

	// Override dom generator.
	getDom: function () {

		let day = moment();
		const dayKeyFormat = "YYYY-MM-DD";
		const upcommingDays = {};
		const endOfDays = day.clone().add(this.config.maximumNumberOfDays, "days");

		const events = this.createEventList();
		const wrapper = document.createElement("table");
		wrapper.className = this.config.tableClass;

		if (events.length === 0) {
			wrapper.innerHTML = (this.loaded) ? this.translate("EMPTY") : this.translate("LOADING");
			wrapper.className = this.config.tableClass + " dimmed";
			return wrapper;
		}

		while (day < endOfDays) {
			const dayKey = day.format(dayKeyFormat);
			upcommingDays[dayKey] = {};
			for(let calendar of this.config.calendars){
				upcommingDays[dayKey][calendar.url] = [];
			}
			day = day.clone().add(1, "day");
		}

		/* Sort the event into the day / calendar object */
		for (var e in events) {
			const event = events[e];
			const endMoment = moment(event.endDate, "x");
			const startMoment = moment(event.startDate, "x");
			const currentEvent = {
				description: event.description,
				fullDayEvent: true,
				geo: event.geo,
				location: event.location,
				title: event.title,
				today: event.today,
				url: event.url
			};

			/* Multi day events  */
			if (!moment(event.endDate, "x").isSame(moment(event.startDate, "x"), "day")){
				const diff = endMoment.diff(startMoment,"days");
				/* Fix for fullDayEvent: They will be recognized as multiday event, because it ends on 0:00 of the next day */
				if(event.fullDayEvent && diff === 1){
					const dateKey = moment(event.startDate, "x").format(dayKeyFormat);
					upcommingDays[dateKey][currentEvent.url].push(event);
				}
				/* all other full day events */
				else if(event.fullDayEvent){
					for(day in upcommingDays){
						if(moment(day).isBetween(startMoment.format(dayKeyFormat), endMoment.format(dayKeyFormat)) || startMoment.isSame(day, "day") ){
							currentEvent["startDate"] = event.startDate;
							currentEvent["endDate"]	= moment(event.endDate, "x").endOf("day");
							upcommingDays[day][currentEvent.url].push(event);
						}
					}
				/* multiday events which are not fullday */
				} else {
					for(day in upcommingDays){
						if(moment(day).isBetween(startMoment.format(dayKeyFormat), endMoment.format(dayKeyFormat)) || startMoment.isSame(day, "day") || endMoment.isSame(day, "day")){
							currentEvent["startDate"] = event.startDate;
							currentEvent["endDate"]	= moment(event.endDate, "x").endOf("day");
							upcommingDays[day][currentEvent.url].push(event);
						}
					}
				}
			}
			/* Single day events */
			else {
				var dateKey = moment(event.startDate, "x").format(dayKeyFormat);
				upcommingDays[dateKey][currentEvent.url].push(event);
			}
		}
		/* Create Table Header */
		var tableHeadRow = document.createElement("tr");
		tableHeadRow.appendChild(document.createElement("th"));
		var columns = {day: ""};
		for(let calendar of this.config.calendars){
			columns[calendar.url] = [];
			let col = document.createElement("th");
			col.innerHTML = calendar.name || "";
			tableHeadRow.appendChild(col);
		}
		wrapper.appendChild(tableHeadRow);

		/* Create table rows for each day */
		for(day in upcommingDays){
			const row = document.createElement("tr");
			const calendars = upcommingDays[day];
			const dayLabel = document.createElement("td");
			dayLabel.innerHTML = moment(day).format("dd");
			row.appendChild(dayLabel);

			for(calendar in calendars){
				const calendarColumn = document.createElement("td");
				for(index in upcommingDays[day][calendar]){
					const event = upcommingDays[day][calendar][index];
					const eventContent = document.createElement("p");

					const time = document.createElement("span");
					time.className = `time ${this.timeClassForUrl(event.url)}`;
					if(!event.fullDayEvent) {
						time.innerText = event.startDate ? moment(event.startDate, "x").format("LT") : "";
					}
					eventContent.appendChild(time);

					const title = document.createElement("span");
					title.className = `title ${this.titleClassForUrl(event.url)}`;
					title.innerText = event.title;
					eventContent.appendChild(title);
					calendarColumn.appendChild(eventContent);
				}
				row.appendChild(calendarColumn);
			}
			wrapper.appendChild(row);
		}
		return wrapper;
	},

	/**
	 * This function accepts a number (either 12 or 24) and returns a moment.js LocaleSpecification with the
	 * corresponding timeformat to be used in the calendar display. If no number is given (or otherwise invalid input)
	 * it will a localeSpecification object with the system locale time format.
	 *
	 * @param {number} timeFormat Specifies either 12 or 24 hour time format
	 * @returns {moment.LocaleSpecification}
	 */
	getLocaleSpecification: function(timeFormat) {
		switch (timeFormat) {
		case 12: {
			return { longDateFormat: {LT: "h:mm A"} };
			break;
		}
		case 24: {
			return { longDateFormat: {LT: "HH:mm"} };
			break;
		}
		default: {
			return { longDateFormat: {LT: moment.localeData().longDateFormat("LT")} };
			break;
		}
		}
	},

	/* hasCalendarURL(url)
	 * Check if this config contains the calendar url.
	 *
	 * argument url string - Url to look for.
	 *
	 * return bool - Has calendar url
	 */
	hasCalendarURL: function (url) {
		for (var c in this.config.calendars) {
			var calendar = this.config.calendars[c];
			if (calendar.url === url) {
				return true;
			}
		}

		return false;
	},

	/* createEventList()
	 * Creates the sorted list of all events.
	 *
	 * return array - Array with events.
	 */
	createEventList: function () {
		var events = [];
		var today = moment().startOf("day");
		var now = new Date();
		var future = moment().startOf("day").add(this.config.maximumNumberOfDays, "days").toDate();
		for (var c in this.calendarData) {
			var calendar = this.calendarData[c];
			for (var e in calendar) {
				var event = JSON.parse(JSON.stringify(calendar[e])); // clone object
				if(event.endDate < now) {
					continue;
				}
				if(this.config.hidePrivate) {
					if(event.class === "PRIVATE") {
						  // do not add the current event, skip it
						  continue;
					}
				}
				if(this.config.hideOngoing) {
					if(event.startDate < now) {
						continue;
					}
				}
				if(this.listContainsEvent(events,event)){
					continue;
				}
				event.url = c;
				event.today = event.startDate >= today && event.startDate < (today + 24 * 60 * 60 * 1000);

				/* if sliceMultiDayEvents is set to true, multiday events (events exceeding at least one midnight) are sliced into days,
				* otherwise, esp. in dateheaders mode it is not clear how long these events are.
				*/
				var maxCount = Math.ceil(((event.endDate - 1) - moment(event.startDate, "x").endOf("day").format("x"))/(1000*60*60*24)) + 1;
				if (this.config.sliceMultiDayEvents && maxCount > 1) {
					var splitEvents = [];
					var midnight = moment(event.startDate, "x").clone().startOf("day").add(1, "day").format("x");
					var count = 1;
					while (event.endDate > midnight) {
						var thisEvent = JSON.parse(JSON.stringify(event)); // clone object
						thisEvent.today = thisEvent.startDate >= today && thisEvent.startDate < (today + 24 * 60 * 60 * 1000);
						thisEvent.endDate = midnight;
						thisEvent.title += " (" + count + "/" + maxCount + ")";
						splitEvents.push(thisEvent);

						event.startDate = midnight;
						count += 1;
						midnight = moment(midnight, "x").add(1, "day").format("x"); // next day
					}
					// Last day
					event.title += " ("+count+"/"+maxCount+")";
					splitEvents.push(event);

					for (event of splitEvents) {
						if ((event.endDate > now) && (event.endDate <= future)) {
							events.push(event);
						}
					}
				} else {
					events.push(event);
				}
			}
		}

		events.sort(function (a, b) {
			return a.startDate - b.startDate;
		});
		return events.slice(0, this.config.maximumEntries);
	},

	listContainsEvent: function(eventList, event){
		for(var evt of eventList){
			if(evt.title === event.title && parseInt(evt.startDate) === parseInt(event.startDate)){
				return true;
			}
		}
		return false;
	},

	/* createEventList(url)
	 * Requests node helper to add calendar url.
	 *
	 * argument url string - Url to add.
	 */
	addCalendar: function (url, auth, calendarConfig) {
		this.sendSocketNotification("ADD_CALENDAR", {
			url: url,
			excludedEvents: calendarConfig.excludedEvents || this.config.excludedEvents,
			maximumEntries: calendarConfig.maximumEntries || this.config.maximumEntries,
			maximumNumberOfDays: calendarConfig.maximumNumberOfDays || this.config.maximumNumberOfDays,
			fetchInterval: this.config.fetchInterval,
			symbolClass: calendarConfig.symbolClass,
			titleClass: calendarConfig.titleClass,
			timeClass: calendarConfig.timeClass,
			auth: auth,
			broadcastPastEvents: calendarConfig.broadcastPastEvents || this.config.broadcastPastEvents,
		});
	},

	/**
	 * symbolsForUrl(url)
	 * Retrieves the symbols for a specific url.
	 *
	 * argument url string - Url to look for.
	 *
	 * return string/array - The Symbols
	 */
	symbolsForUrl: function (url) {
		return this.getCalendarProperty(url, "symbol", this.config.defaultSymbol);
	},

	/**
	 * symbolClassForUrl(url)
	 * Retrieves the symbolClass for a specific url.
	 *
	 * @param url string - Url to look for.
	 *
	 * @returns string
	 */
	symbolClassForUrl: function (url) {
		return this.getCalendarProperty(url, "symbolClass", "");
	},

	/**
	 * titleClassForUrl(url)
	 * Retrieves the titleClass for a specific url.
	 *
	 * @param url string - Url to look for.
	 *
	 * @returns string
	 */
	titleClassForUrl: function (url) {
		return this.getCalendarProperty(url, "titleClass", "");
	},

	/**
	 * timeClassForUrl(url)
	 * Retrieves the timeClass for a specific url.
	 *
	 * @param url string - Url to look for.
	 *
	 * @returns string
	 */
	timeClassForUrl: function (url) {
		return this.getCalendarProperty(url, "timeClass", "");
	},

	/* calendarNameForUrl(url)
	 * Retrieves the calendar name for a specific url.
	 *
	 * argument url string - Url to look for.
	 *
	 * return string - The name of the calendar
	 */
	calendarNameForUrl: function (url) {
		return this.getCalendarProperty(url, "name", "");
	},

	/* colorForUrl(url)
	 * Retrieves the color for a specific url.
	 *
	 * argument url string - Url to look for.
	 *
	 * return string - The Color
	 */
	colorForUrl: function (url) {
		return this.getCalendarProperty(url, "color", "#fff");
	},

	/* countTitleForUrl(url)
	 * Retrieves the name for a specific url.
	 *
	 * argument url string - Url to look for.
	 *
	 * return string - The Symbol
	 */
	countTitleForUrl: function (url) {
		return this.getCalendarProperty(url, "repeatingCountTitle", this.config.defaultRepeatingCountTitle);
	},

	/* getCalendarProperty(url, property, defaultValue)
	 * Helper method to retrieve the property for a specific url.
	 *
	 * argument url string - Url to look for.
	 * argument property string - Property to look for.
	 * argument defaultValue string - Value if property is not found.
	 *
	 * return string - The Property
	 */
	getCalendarProperty: function (url, property, defaultValue) {
		for (var c in this.config.calendars) {
			var calendar = this.config.calendars[c];
			if (calendar.url === url && calendar.hasOwnProperty(property)) {
				return calendar[property];
			}
		}

		return defaultValue;
	},

	/**
	 * Shortens a string if it's longer than maxLength and add a ellipsis to the end
	 *
	 * @param {string} string Text string to shorten
	 * @param {number} maxLength The max length of the string
	 * @param {boolean} wrapEvents Wrap the text after the line has reached maxLength
	 * @param {number} maxTitleLines The max number of vertical lines before cutting event title
	 * @returns {string} The shortened string
	 */
	shorten: function (string, maxLength, wrapEvents, maxTitleLines) {
		if (typeof string !== "string") {
			return "";
		}

		if (wrapEvents === true) {
			var temp = "";
			var currentLine = "";
			var words = string.split(" ");
			var line = 0;

			for (var i = 0; i < words.length; i++) {
				var word = words[i];
				if (currentLine.length + word.length < (typeof maxLength === "number" ? maxLength : 25) - 1) { // max - 1 to account for a space
					currentLine += (word + " ");
				} else {
					line++;
					if (line > maxTitleLines - 1) {
						if (i < words.length) {
							currentLine += "&hellip;";
						}
						break;
					}

					if (currentLine.length > 0) {
						temp += (currentLine + "<br>" + word + " ");
					} else {
						temp += (word + "<br>");
					}
					currentLine = "";
				}
			}

			return (temp + currentLine).trim();
		} else {
			if (maxLength && typeof maxLength === "number" && string.length > maxLength) {
				return string.trim().slice(0, maxLength) + "&hellip;";
			} else {
				return string.trim();
			}
		}
	},

	/* capFirst(string)
	 * Capitalize the first letter of a string
	 * Return capitalized string
	 */
	capFirst: function (string) {
		return string.charAt(0).toUpperCase() + string.slice(1);
	},

	/* titleTransform(title)
	 * Transforms the title of an event for usage.
	 * Replaces parts of the text as defined in config.titleReplace.
	 * Shortens title based on config.maxTitleLength and config.wrapEvents
	 *
	 * argument title string - The title to transform.
	 *
	 * return string - The transformed title.
	 */
	titleTransform: function (title) {
		for (var needle in this.config.titleReplace) {
			var replacement = this.config.titleReplace[needle];

			var regParts = needle.match(/^\/(.+)\/([gim]*)$/);
			if (regParts) {
			  // the parsed pattern is a regexp.
			  needle = new RegExp(regParts[1], regParts[2]);
			}

			title = title.replace(needle, replacement);
		}

		title = this.shorten(title, this.config.maxTitleLength, this.config.wrapEvents, this.config.maxTitleLines);
		return title;
	},

	/* broadcastEvents()
	 * Broadcasts the events to all other modules for reuse.
	 * The all events available in one array, sorted on startdate.
	 */
	broadcastEvents: function () {
		var eventList = [];
		for (var url in this.calendarData) {
			var calendar = this.calendarData[url];
			for (var e in calendar) {
				var event = cloneObject(calendar[e]);
				event.symbol = this.symbolsForUrl(url);
				event.calendarName = this.calendarNameForUrl(url);
				event.color = this.colorForUrl(url);
				delete event.url;
				eventList.push(event);
			}
		}

		eventList.sort(function(a,b) {
			return a.startDate - b.startDate;
		});

		this.sendNotification("CALENDAR_EVENTS", eventList);

	}
});
