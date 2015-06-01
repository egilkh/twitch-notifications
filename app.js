/*
  @todo URL for twitch names to include.
  @todo Show a link somewhere with all the names includes for sharing.
  @todo OpenGraph sharing thingys.
  @todo AddChannel - Check if the user exists.
  @todo AddChannel - Highlight existing streams.
  @todo Embed the streams for viewing directly, one player?
  @todo Immidiate online status.
  @todo Mobile Notifications ?
  @todo Cross to remove in thumbnail mode.
  @todo When adding a channel, lookup and set status.
  @todo Show title in table and in preview mode.
*/

'use strict';

/* globals angular:true */

angular.module('TN', ['ngResource', 'ngStorage'])

.config(['$logProvider',
  function ($logProvider) {
    $logProvider.debugEnabled(false);
  }])

.run(['$localStorage', '$sessionStorage',
  function ($localStorage, $sessionStorage) {
    if (!$localStorage.Channels) {
      $localStorage.Channels = [];
    }

    if (!$localStorage.LastUpdated) {
      $localStorage.LastUpdated = 0;
    }

    if (!$localStorage.Options) {
      $localStorage.Options = {};
    }

    var defaultOptions = {
      Notification: false,
      Sound: false,
      View: 'List',
      OnlyShowOnline: false,
    };

    $localStorage.Options = angular.extend({}, defaultOptions, $localStorage.Options);

    if (!$sessionStorage.Statuses) {
      $sessionStorage.Statuses = {};
    }

    angular.forEach($localStorage.Channels, function (c, i) {
      if (!c.name) {
        $localStorage.Channels.splice(i, 1);
      }

      c.online = ($sessionStorage.Statuses[c.name] && $sessionStorage.Statuses[c.name].stream) ? true : false;
    });

  }])

.controller('TNCtrl', ['$scope', '$interval', '$q', '$timeout', '$location', '$log', '$localStorage', '$sessionStorage', 'Stream', 'Following', 'Notification',
  function ($scope, $interval, $q, $timeout, $location, $log, $localStorage, $sessionStorage, Stream, Following, Notification) {
    $scope.Channels = $localStorage.Channels;
    $scope.LastUpdated = $localStorage.LastUpdated;
    $scope.Options = $localStorage.Options;

    $scope.Statuses = $sessionStorage.Statuses;

    var oneSecond = 1000,
        oneMinute = 60 * oneSecond,
        minWait = 2 * oneMinute,
        intervalWait = 10 * oneSecond;

    $scope.AllowUpdate = function () {
      var timeSince = Date.now() - $localStorage.LastUpdated;
      return timeSince > minWait;
    };

    var getStreamData = function (channelName, index) {
      var wait = 200 * (index || 1);
      var i = index;

      return $q(function (resolve, reject) {
         $timeout(function () {
            $log.debug(new Date(), 'Queing %s, waiting %s.', channelName, wait);
            return channelName;
          }, wait)
          .then(function (channelName) {
            $log.debug('Fetching ' + channelName);
            return Stream.get({ channel: channelName }).$promise;
          })
          .then(function (d) {
            $log.debug('Data for %s', channelName, d);
            if (d.error) {
              $log.error(d);
              return channelName;
            }

            // Twitch CDN supports https://
            // Remove http: from previews leaving us with // URLS.
            if (d.stream && d.stream.preview) {
              angular.forEach(d.stream.preview, function (p, i) {
                d.stream.preview[i] = d.stream.preview[i].replace('http:', '');
              });
            }

            $scope.Statuses[channelName] = d;
            if (!$scope.Channels[i].online && d.stream) {
              // @todo Create a default icon.
              var icon = d.stream.channel.logo ? d.stream.channel.logo.replace('http:', '') : '';
              Notification.Notify(channelName, {
                body: 'has come online.',
                icon: icon,
              });
            }
            $scope.Channels[i].online = d.stream ? true : false;

            if ($scope.Channels[i].online) {
              $scope.Channels[i].logo = d.stream.channel.logo ? d.stream.channel.logo.replace('http:', '') : '';
              $scope.Channels[i].lastSeen = Date.now();
              $scope.Channels[i].displayName = d.stream.channel.display_name;
            }

            return channelName;
          })
          .then(function (c) {
            $log.debug('Finished "%s".', c);
            resolve(c);
          })
          .catch(function (d) {
            reject(d);
          });
      });
    };

    $scope.Update = function () {
      $log.debug('Update started.');

      if (!$scope.AllowUpdate()) {
        $log.debug('Update aborted, too soon?');
        return;
      }

      $log.debug('Updating streams.');

      var p = [];
      angular.forEach($scope.Channels, function (c, i) {
        p.push(getStreamData(c.name, i));
      });

      $q.all(p)
      .then(function () {
        $log.debug('All channels finished.');
        $scope.LastUpdated = $localStorage.LastUpdated = Date.now();
      });
    };

    var interval = $interval(function () {
      $log.debug('Interval tick.');
      $scope.Update();
    }, intervalWait);

    $scope.$on('destroy', function () {
      $interval.cancel(interval);
    });

    $scope.AddChannel = function (channelName) {
      channelName = channelName.trim();

      for (var i = 0; i < $scope.Channels.length; i++) {
        if ($scope.Channels[i].name === channelName) {
          return;
        }
      }

      $scope.Channels.push({
        name: channelName.trim(),
        online: false,
        last: null,
      });

      $scope.AddChannelName = '';
      updateSteamLinkList();
    };

    $scope.RemoveChannel = function (channelName) {
      channelName = channelName.trim();

      for (var i = 0; i < $scope.Channels.length; i++) {
        if ($scope.Channels[i].name === channelName) {
          $log.debug('Removing %s.', channelName);
          $scope.Channels.splice(i, 1);
        }
      }

      updateSteamLinkList();
    };

    var updateSteamLinkList = function () {
      var x = [];
      angular.forEach($scope.Channels, function (c) {
        x.push(c.name);
      });
      $scope.SteamLinkList = x.join(',');
    };
    updateSteamLinkList();

    $scope.filterOnline = function (c) {
      return $scope.Options.OnlyShowOnline ? c.online === true : true;
    };

    $scope.ImportChannelsWorking = false;
    $scope.ImportChannels = function (userName) {
      $scope.ImportChannelsWorking = true;

      Following.get({ user: userName, limit: 100, offset: 0}).$promise
      .then(function (d) {
        if (d.error) {
          $log.error(d.error);
          return false;
        }
        angular.forEach(d.follows, function (f) {
          $scope.AddChannel(f.channel.name);
        });

        $scope.ImportChannelsWorking = false;
        $scope.ImportChannelsName = '';
        return true;
      });

    };

    $scope.notificationChange = function () {
      Notification.Setup();
    };

    $log.debug('App started.');
    $log.debug('Current channels: ', $scope.Channels);

    var l = $location.search().l ? $location.search().l.split(',') : [];
    angular.forEach(l, function (l) {
      $scope.AddChannel(l.trim());
    });
    $location.search({});

    $scope.Update();
  }])

.service('Notification', ['$window', '$timeout', '$localStorage', 'Sound',
  function ($window, $timeout, $localStorage, Sound) {
    if (!('Notification' in window)) {
      return {
        Notify: function () {},
        Setup: function () {}
      };
    }

    var askforPermission = function () {
      if ($localStorage.Options.Notification &&
          $window.Notification.permission !== 'denied' &&
          $window.Notification.permission !== 'granted') {

        $window.Notification.requestPermission(function (permission) {
          if (permission !== 'granted') {
            $localStorage.Options.Notification = false;
          }
        });
      }
    };

    var Notification = {};
    Notification.Notify = function (title, options) {
      if ($window.Notification.permission === 'granted') {
        var notification = new $window.Notification(title, options);
        Sound.Play();
        $timeout(function () {
          notification.close();
        }, 6000);
      }
    };

    Notification.Setup = function () {
      askforPermission();
    };

    Notification.Setup();

    return Notification;
  }])

.service('Sound', ['$window', '$localStorage',
  function ($window ,$localStorage) {
    var s = $window.document.getElementById('audioPlayer');

    return {
      Play: function () {
        if ($localStorage.Options.Sound) {
          s.play();
        }
      }
    };
  }])

.service('Stream', ['$resource',
  function ($resource){
    return $resource('https://api.twitch.tv/kraken/streams/:channel/', {
      callback: 'JSON_CALLBACK'
    }, {
      get: {
        method: 'JSONP',
        isArray: false
      }
    });
  }])

.service('Following', ['$resource',
  function ($resource) {
    return $resource('https://api.twitch.tv/kraken/users/:user/follows/channels', {
      callback: 'JSON_CALLBACK'
    }, {
      get: {
        method: 'JSONP',
        isArray: false
      }
    });
  }])

;
