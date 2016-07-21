var clock, minute;


(function($) {
	
	$(function() {
		
		clock  = $('.flip-counter').FlipClock();
				
		$('.waypoint').waypoint(function() {
			var id = $(this).attr('id');
			
			$('.sidebar li').removeClass('active');
			$('.sidebar a[href="#'+id+'"]').parent().addClass('active');
		});
		
		var $sidebar = $('.sidebar');
			
		$('.hinge-nav').waypoint(function() {
			$sidebar.removeClass('fixed');
		});
		
		$('.unhinge-nav').waypoint(function() {
			$sidebar.addClass('fixed');
			_resizeSidebar();
		});
		
		$('.sidebar li a').click(function(e) {
			var $t = $(this);
			$('.sidebar .active').removeClass('active');
			$t.addClass('active');
		});

		$('a[href^=#]').click(function(){
			var $t = $(this);
		    $('html, body').animate({
		        scrollTop: $( $.attr(this, 'href') ).offset().top
		    }, 500, function() { 
		    	$('.sidebar .active').removeClass('active'); 
		    	$t.parent().addClass('active'); 
		    });
		    return false;
		});

		$(window).resize(function() {
			_resizeSidebar();
		});
		
		function _resizeSidebar() {
			$sidebar.parent().attr('style', false);
				
			if($sidebar.hasClass('fixed')) {
				$sidebar.width($sidebar.parent().width());
			}
		}
	});
	
}(jQuery));
