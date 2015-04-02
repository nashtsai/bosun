interface IConfig2Scope extends IBosunScope {
	// text loading/navigation
	config_text: string;
	selected_alert: string;
	items: { [type: string]: string[]; };
	scrollTo: (type:string,name:string) => void;
	aceLoaded: (editor:any) => void;
	validate: () => void;
	validationResult: string;
	selectAlert: (alert:string) => void;
	
	//rule execution options
	fromDate: string;
	toDate: string;
	fromTime: string;
	toTime: string;
	intervals: number;
	duration: number;
	email: string;
	template_group: string;
	setInterval: () => void;
	setDuration: () => void;
	
	//rule execution
	running: boolean;
	error: string;
	warning: string[];
	test: () => void;
	sets: any;
	alert_history: any;
	subject: string;
	body: string;
	data: any;
	tab: string;
}



bosunControllers.controller('Config2Ctrl', ['$scope', '$http', '$location', '$route', '$timeout','$sce', function($scope: IConfig2Scope, $http: ng.IHttpService, $location: ng.ILocationService, $route: ng.route.IRouteService, $timeout: ng.ITimeoutService, $sce: ng.ISCEService) {
	var search = $location.search();
	$scope.fromDate = search.fromDate || '';
	$scope.fromTime = search.fromTime || '';
	$scope.toDate = search.toDate || '';
	$scope.toTime = search.toTime || '';
	$scope.intervals = +search.intervals || 5;
	$scope.duration = +search.duration || null;
	$scope.config_text = 'Loading config...';
	$scope.selected_alert = search.alert || '';
	$scope.email = search.email || '';
	$scope.template_group = search.template_group || '';
	$scope.items = parseItems();
	$scope.tab = search.tab || 'results';
	
	function parseItems() : { [type: string]: string[]; }{
		var configText = $scope.config_text;
		var re = /^\s*(alert|template|notification|lookup|macro)\s+([\w\-\.\$]+)\s*\{/gm; 
		var match;
		var items : { [type: string]: string[]; } = {};
		items["alert"] = [];
		items["template"] = [];
		items["lookup"] = [];
		items["notification"] = [];
		items["macro"] = [];
		while (match = re.exec(configText)) {
        		var type = match[1];
			var name = match[2];
			var list = items[type];
			if (!list){
				list = [];
				items[type] = list;
			}
			list.push(name)
		}
		return items
	}

	var editor;
	
	$http.get('/api/config')
		.success((data) => {
			$scope.config_text = data;
			$scope.items = parseItems();
			if(!$scope.selected_alert && $scope.items["alert"].length){
				$scope.selected_alert = $scope.items["alert"][0];
			}
			$timeout(()=>{ 
				//can't scroll editor until after control is updated. Defer it.
				$scope.scrollTo("alert",$scope.selected_alert)
			})
			
		})
		.error(function(data) {
   			$scope.validationResult = "Error fetching config: " + data;
  		})
	
	$scope.aceLoaded = function(_editor){
		editor = _editor;
		editor.getSession().setUseWrapMode(true);
		editor.on("blur", function(){
			$scope.$apply(function () {
            		$scope.items = parseItems();
        		});
		});
	};
	
	$scope.scrollTo = (type:string, name:string) => {
		var searchRegex = new RegExp("^\\s*"+type+"\\s+"+name+"\\s*\\{", "gm");
		editor.find(searchRegex,{
    			backwards: false,
    			wrap: true,
    			caseSensitive: false,
    			wholeWord: false,
    			regExp: true,
		});
		if (type == "alert"){$scope.selectAlert(name);}
	}
	
	$scope.setInterval = () => {
		var from = moment.utc($scope.fromDate + ' ' + $scope.fromTime);
		var to = moment.utc($scope.toDate + ' ' + $scope.toTime);
		if (!from.isValid() || !to.isValid()) {
			return;
		}
		var diff = from.diff(to);
		if (!diff) {
			return;
		}
		var intervals = +$scope.intervals;
		if (intervals < 2) {
			return;
		}
		diff /= 1000 * 60;
		var d = Math.abs(Math.round(diff / intervals));
		if (d < 1) {
			d = 1;
		}
		$scope.duration = d;
	};
	
	$scope.selectAlert = (alert:string) =>{
		$scope.selected_alert = alert;
		$location.search("alert",alert);
	}
	
	var line_re = /test:(\d+)/;
	$scope.validate = () => {
		$http.get('/api/config_test?config_text=' + encodeURIComponent($scope.config_text))
			.success((data) => {
				if (data == "") {
					$scope.validationResult = "Valid";
					$timeout(()=>{ 
						$scope.validationResult = "";
					},2000)
				} else {
					$scope.validationResult = data;
					var m = data.match(line_re);
					if (angular.isArray(m) && (m.length > 1)) {
						editor.gotoLine(m[1])
					}
				}
			})
			.error((error) => {
				$scope.validationResult = 'Error validating: ' + error;
			});
	}
	
	$scope.test = () => {
		$scope.error = '';
		$scope.running = true;
		$scope.warning = [];
		$location.search('fromDate', $scope.fromDate || null);
		$location.search('fromTime', $scope.fromTime || null);
		$location.search('toDate', $scope.toDate || null);
		$location.search('toTime', $scope.toTime || null);
		$location.search('intervals', String($scope.intervals) || null);
		$location.search('duration', String($scope.duration) || null);
		$location.search('email', $scope.email || null);
		$location.search('template_group', $scope.template_group || null);
		$scope.animate();
		var from = moment.utc($scope.fromDate + ' ' + $scope.fromTime);
		var to = moment.utc($scope.toDate + ' ' + $scope.toTime);
		if (!from.isValid()) {
			from = to;
		}
		if (!to.isValid()) {
			to = from;
		}
		if (!from.isValid() && !to.isValid()) {
			from = to = moment.utc();
		}
		var diff = from.diff(to);
		var intervals;
		if (diff == 0) {
			intervals = 1;
		} else if (Math.abs(diff) < 60 * 1000) { // 1 minute
			intervals = 2;
		} else {
			intervals = +$scope.intervals;
		}
		var url = '/api/rule?' +
			'alert=' + encodeURIComponent($scope.selected_alert) +
			'&from=' + encodeURIComponent(from.format()) +
			'&to=' + encodeURIComponent(to.format()) +
			'&intervals=' + encodeURIComponent(intervals) +
			'&email=' + encodeURIComponent($scope.email) +
			'&template_group=' + encodeURIComponent($scope.template_group);
		$http.post(url,$scope.config_text)
			.success((data) => {
				$scope.sets = data.Sets;
				$scope.alert_history = data.AlertHistory;
				procResults(data);
			})
			.error((error) => {
				$scope.error = error;
			})
			.finally(() => {
				$scope.running = false;
				$scope.stop();
			});
	}
	function procResults(data: any) {
		$scope.subject = data.Subject;
		$scope.body = $sce.trustAsHtml(data.Body);
		$scope.data = JSON.stringify(data.Data, null, '  ');
		$scope.error = data.Errors;
		$scope.warning = data.Warnings;
	}
	return $scope;
}]);